<script lang="ts">
  import { onMount } from 'svelte';
  import type { DhcpLease, DhcpReservation, DhcpScope } from '@ultimate-dash/shared';
  import { ipv4PoolSize, ipv4ToInt } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { formatDuration } from '$lib/format';
  import { theme } from '$lib/theme.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ReservationForm, { type ReservationValues } from '$lib/components/ReservationForm.svelte';
  import TechNav from '$lib/components/TechNav.svelte';
  import UiIcon from '$lib/components/UiIcon.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';

  type Reservation = DhcpReservation & { scope: string };

  let scopes = $state<DhcpScope[]>([]);
  let leases = $state<DhcpLease[]>([]);
  let loaded = $state(false);
  let notConfigured = $state(false);
  let error = $state<string | null>(null);
  let refreshing = $state(false);

  let tab = $state<'leases' | 'reservations'>('leases');
  let scopeFilter = $state('');
  let query = $state('');

  let form = $state<{
    open: boolean;
    existing: Reservation | null;
    initial: Partial<ReservationValues> | null;
  }>({ open: false, existing: null, initial: null });
  let confirm = $state<{
    open: boolean;
    title: string;
    message: string;
    label: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', label: 'Löschen', action: async () => {} });

  const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

  /** Technitium liefert „MM/dd/yyyy HH:mm:ss“; unlesbare Werte bleiben unverändert stehen. */
  function formatTime(value: string | null): string {
    if (!value) return '–';
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!m) return value;
    return dateFormat.format(new Date(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, +m[6]!));
  }

  const byAddress = (a: { address: string }, b: { address: string }) =>
    (ipv4ToInt(a.address) ?? 0) - (ipv4ToInt(b.address) ?? 0);

  const reservations = $derived<Reservation[]>(
    scopes.flatMap((s) => s.reservations.map((r) => ({ ...r, scope: s.name }))),
  );
  const matches = (parts: (string | null)[]) => {
    const q = query.trim().toLowerCase();
    return !q || parts.some((p) => p?.toLowerCase().includes(q));
  };
  const leaseRows = $derived(
    leases
      .filter(
        (l) =>
          (!scopeFilter || l.scope === scopeFilter) &&
          matches([l.address, l.hostName, l.hardwareAddress]),
      )
      .sort(byAddress),
  );
  const reservationRows = $derived(
    reservations
      .filter(
        (r) =>
          (!scopeFilter || r.scope === scopeFilter) &&
          matches([r.address, r.hostName, r.hardwareAddress, r.comments]),
      )
      .sort(byAddress),
  );

  /** Belegung eines Scopes: dynamische Leases im Verhältnis zu den verteilbaren Adressen. */
  function usage(scope: DhcpScope) {
    const pool = ipv4PoolSize(scope.startingAddress, scope.endingAddress, scope.exclusions);
    const dynamic = leases.filter((l) => l.scope === scope.name && l.type === 'Dynamic').length;
    return { pool, dynamic, share: pool > 0 ? Math.min(1, dynamic / pool) : 0 };
  }

  async function load(initial = false) {
    refreshing = !initial;
    try {
      [scopes, leases] = await Promise.all([api.dhcpScopes(), api.dhcpLeases()]);
      error = null;
      notConfigured = false;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not-configured') notConfigured = true;
      else error = e instanceof Error ? e.message : 'DHCP-Daten konnten nicht geladen werden';
    } finally {
      loaded = true;
      refreshing = false;
    }
  }
  onMount(() => void load(true));

  async function perform(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toasts.show(success);
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Aktion fehlgeschlagen', 'error');
    }
    await load();
  }

  const toggleScope = (scope: DhcpScope) =>
    perform(
      () => api.setDhcpScope({ scope: scope.name, enabled: !scope.enabled }),
      `${scope.name} ${scope.enabled ? 'deaktiviert' : 'aktiviert'}`,
    );

  function ask(
    title: string,
    message: string,
    label: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    confirm = {
      open: true,
      title,
      message,
      label,
      action: async () => {
        await perform(action, success);
        confirm.open = false;
      },
    };
  }

  const leaseLabel = (l: DhcpLease) => `${l.address}${l.hostName ? ` (${l.hostName})` : ''}`;

  const reserveLease = (l: DhcpLease) =>
    perform(
      () =>
        api.dhcpLeaseAction({
          scope: l.scope,
          hardwareAddress: l.hardwareAddress,
          action: 'reserve',
        }),
      `${l.address} reserviert`,
    );

  const releaseLease = (l: DhcpLease) =>
    ask(
      l.type === 'Reserved' ? 'Reservierung aufheben?' : 'Lease freigeben?',
      l.type === 'Reserved'
        ? `${leaseLabel(l)} wird wieder zu einer normalen, dynamischen Lease.`
        : `${leaseLabel(l)} wird freigegeben. Das Gerät bekommt beim nächsten Erneuern eine Adresse.`,
      l.type === 'Reserved' ? 'Aufheben' : 'Freigeben',
      () =>
        api.dhcpLeaseAction({
          scope: l.scope,
          hardwareAddress: l.hardwareAddress,
          action: l.type === 'Reserved' ? 'unreserve' : 'remove',
        }),
      l.type === 'Reserved' ? 'Reservierung aufgehoben' : 'Lease freigegeben',
    );

  const removeLease = (l: DhcpLease) =>
    ask(
      'Lease löschen?',
      `${leaseLabel(l)} wird aus Technitium entfernt${l.type === 'Reserved' ? ', die Reservierung geht dabei verloren' : ''}. Achtung: Das Gerät kann die Adresse sofort wieder bekommen oder ein anderes Gerät sie.`,
      'Löschen',
      () =>
        api.dhcpLeaseAction({
          scope: l.scope,
          hardwareAddress: l.hardwareAddress,
          action: 'remove',
        }),
      'Lease gelöscht',
    );

  const removeReservation = (r: Reservation) =>
    ask(
      'Reservierung löschen?',
      `${r.address}${r.hostName ? ` (${r.hostName})` : ''} für ${r.hardwareAddress} wird gelöscht.`,
      'Löschen',
      () => api.deleteDhcpReservation({ scope: r.scope, hardwareAddress: r.hardwareAddress }),
      'Reservierung gelöscht',
    );

  async function saveReservation(values: ReservationValues) {
    const input = {
      scope: values.scope,
      hardwareAddress: values.hardwareAddress,
      ipAddress: values.ipAddress.trim(),
      hostName: values.hostName,
      comments: values.comments,
    };
    const current = form.existing;
    if (current) {
      await api.updateDhcpReservation({
        ...input,
        currentHardwareAddress: current.hardwareAddress,
      });
    } else {
      await api.addDhcpReservation(input);
    }
    toasts.show(current ? 'Reservierung gespeichert' : 'Reservierung angelegt');
    form.open = false;
    await load();
  }
</script>

<div class="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
  <header class="flex flex-wrap items-center gap-3">
    <a href="/" class="icon-btn" aria-label="Zurück zum Dashboard"><UiIcon name="back" /></a>
    <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
      <UiIcon name="server" size={20} class="text-fg-muted" /> DHCP
    </h1>
    <TechNav />
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="icon-btn"
        aria-label="Neu laden"
        title="Neu laden"
        disabled={refreshing}
        onclick={() => load()}
      >
        <UiIcon name="refresh" size={16} class={refreshing ? 'animate-spin' : ''} />
      </button>
      <button
        type="button"
        class="icon-btn"
        onclick={() => theme.toggle()}
        aria-label={theme.current === 'dark' ? 'Helles Design' : 'Dunkles Design'}
      >
        <UiIcon name={theme.current === 'dark' ? 'sun' : 'moon'} />
      </button>
      <UserMenu />
    </div>
  </header>

  {#if notConfigured}
    <div class="mx-auto max-w-md rounded-2xl border border-dashed border-line p-6 text-center">
      <p class="font-medium">Technitium ist noch nicht verbunden.</p>
      <p class="mt-1 text-sm text-fg-muted">
        {auth.isAdmin
          ? 'Richte die Verbindung im Benutzermenü unter „Technitium DNS“ ein.'
          : 'Ein Administrator kann die Verbindung einrichten.'}
      </p>
    </div>
  {:else if error && !loaded}
    <div
      class="mx-auto max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
      role="alert"
    >
      <p class="font-medium">DHCP-Daten konnten nicht geladen werden.</p>
      <p class="mt-1 text-sm text-fg-muted">{error}</p>
      <button type="button" class="btn mt-4" onclick={() => load(true)}>Erneut versuchen</button>
    </div>
  {:else if !loaded}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Lädt">
      {#each Array(2) as _, i (i)}<div class="h-36 animate-pulse rounded-2xl bg-muted"></div>{/each}
    </div>
  {:else}
    {#if error}
      <p class="text-xs text-down" role="status">Aktualisierung fehlgeschlagen: {error}</p>
    {/if}

    <!-- Scopes -->
    <section aria-label="Scopes" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {#each scopes as scope (scope.name)}
        {@const u = usage(scope)}
        <article
          class="grid content-start gap-3 rounded-2xl border border-line bg-elevated p-4"
          class:opacity-70={!scope.enabled}
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h2 class="truncate font-semibold">{scope.name}</h2>
              <p class="font-mono text-xs text-fg-muted">
                {scope.startingAddress} – {scope.endingAddress}
              </p>
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-medium"
              class:bg-up={scope.enabled}
              class:text-white={scope.enabled}
              class:bg-muted={!scope.enabled}>{scope.enabled ? 'Aktiv' : 'Aus'}</span
            >
          </div>

          <div>
            <div class="mb-1 flex items-baseline justify-between text-xs">
              <span class="text-fg-muted">Dynamische Leases</span>
              <span class="tabular-nums"
                ><span class="font-semibold">{u.dynamic}</span> von {u.pool}</span
              >
            </div>
            <div
              class="h-2 rounded-full bg-muted"
              role="meter"
              aria-label="Belegung von {scope.name}"
              aria-valuemin="0"
              aria-valuemax={u.pool}
              aria-valuenow={u.dynamic}
            >
              <div
                class="h-full rounded-full"
                style="width: {Math.max(
                  u.dynamic > 0 ? 2 : 0,
                  u.share * 100,
                )}%; background: {u.share > 0.9
                  ? 'var(--down)'
                  : u.share > 0.75
                    ? 'var(--chart-authoritative)'
                    : 'var(--chart-queries)'}"
              ></div>
            </div>
          </div>

          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt class="text-fg-muted">Netzmaske</dt>
            <dd class="font-mono">{scope.subnetMask}</dd>
            {#if scope.routerAddress}
              <dt class="text-fg-muted">Gateway</dt>
              <dd class="font-mono">{scope.routerAddress}</dd>
            {/if}
            {#if scope.domainName}
              <dt class="text-fg-muted">Domain</dt>
              <dd class="font-mono">{scope.domainName}</dd>
            {/if}
            <dt class="text-fg-muted">Leasedauer</dt>
            <dd>{formatDuration(scope.leaseMinutes)}</dd>
            <dt class="text-fg-muted">Reserviert</dt>
            <dd>{scope.reservations.length}</dd>
            {#if scope.exclusions.length > 0}
              <dt class="text-fg-muted">Ausgenommen</dt>
              <dd class="font-mono">
                {scope.exclusions
                  .map((x) => `${x.startingAddress} – ${x.endingAddress}`)
                  .join(', ')}
              </dd>
            {/if}
          </dl>

          {#if auth.isAdmin}
            <button
              type="button"
              class="btn justify-self-start py-1.5"
              onclick={() => toggleScope(scope)}
            >
              <UiIcon name={scope.enabled ? 'pause' : 'play'} size={14} />
              {scope.enabled ? 'Deaktivieren' : 'Aktivieren'}
            </button>
          {/if}
        </article>
      {:else}
        <p class="col-span-full py-6 text-center text-fg-muted">
          Es sind keine DHCP-Scopes eingerichtet.
        </p>
      {/each}
    </section>

    <!-- Leases und Reservierungen -->
    <section aria-label="Leases und Reservierungen" class="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <div
          class="inline-flex rounded-lg border border-line bg-elevated p-0.5"
          role="tablist"
          aria-label="Ansicht"
        >
          {#each [{ value: 'leases', label: 'Leases', count: leases.length }, { value: 'reservations', label: 'Reservierungen', count: reservations.length }] as const as t (t.value)}
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              class="rounded-md px-3 py-1 text-sm font-medium transition"
              class:bg-muted={tab === t.value}
              class:text-fg-muted={tab !== t.value}
              onclick={() => (tab = t.value)}
              >{t.label} <span class="text-xs font-normal text-fg-muted">{t.count}</span></button
            >
          {/each}
        </div>
        <label class="sr-only" for="dhcp-scope">Scope</label>
        <select id="dhcp-scope" class="input w-auto py-1.5" bind:value={scopeFilter}>
          <option value="">Alle Scopes</option>
          {#each scopes as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
        </select>
        <label class="sr-only" for="dhcp-search">Suchen</label>
        <input
          id="dhcp-search"
          class="input w-52 py-1.5"
          type="search"
          placeholder="IP, Name oder MAC …"
          bind:value={query}
        />
        {#if auth.isAdmin && scopes.length > 0}
          <button
            type="button"
            class="btn btn-primary ml-auto py-1.5"
            onclick={() =>
              (form = {
                open: true,
                existing: null,
                initial: scopeFilter ? { scope: scopeFilter } : null,
              })}
          >
            <UiIcon name="plus" size={16} /> Neue Reservierung
          </button>
        {/if}
      </div>

      <div class="relative overflow-x-auto rounded-2xl border border-line bg-elevated">
        {#if tab === 'leases'}
          <table class="w-full min-w-[44rem] text-left text-sm">
            <caption class="sr-only">DHCP-Leases</caption>
            <thead class="border-b border-line text-xs text-fg-muted">
              <tr>
                <th class="px-4 py-2 font-medium">IP-Adresse</th>
                <th class="px-2 py-2 font-medium">Hostname</th>
                <th class="px-2 py-2 font-medium">MAC</th>
                <th class="px-2 py-2 font-medium">Art</th>
                <th class="px-2 py-2 font-medium">Scope</th>
                <th class="px-2 py-2 font-medium">Läuft ab</th>
                <th class="w-24 px-2 py-2"><span class="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each leaseRows as lease (lease.scope + lease.hardwareAddress)}
                <tr>
                  <td class="px-4 py-2 font-mono text-[13px]">{lease.address}</td>
                  <td class="max-w-48 truncate px-2 py-2" title={lease.hostName ?? ''}
                    >{lease.hostName ?? '–'}</td
                  >
                  <td class="px-2 py-2 font-mono text-xs">{lease.hardwareAddress}</td>
                  <td class="px-2 py-2">
                    <span
                      class="rounded px-1.5 py-0.5 text-[11px] font-medium"
                      class:bg-accent={lease.type === 'Reserved'}
                      class:text-accent-contrast={lease.type === 'Reserved'}
                      class:bg-muted={lease.type !== 'Reserved'}
                      >{lease.type === 'Reserved' ? 'Reserviert' : 'Dynamisch'}</span
                    >
                  </td>
                  <td class="px-2 py-2 text-fg-muted">{lease.scope}</td>
                  <td class="px-2 py-2 text-xs whitespace-nowrap text-fg-muted"
                    >{formatTime(lease.expires)}</td
                  >
                  <td class="px-2 py-1 text-right whitespace-nowrap">
                    {#if auth.isAdmin}
                      {#if lease.type === 'Dynamic'}
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="{lease.address} reservieren"
                          title="Reservieren"
                          onclick={() => reserveLease(lease)}
                        >
                          <UiIcon name="pin" size={15} />
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Reservierung von {lease.address} aufheben"
                          title="Reservierung aufheben"
                          onclick={() => releaseLease(lease)}
                        >
                          <UiIcon name="unpin" size={15} />
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="icon-btn hover:text-down"
                        aria-label="{lease.address} {lease.type === 'Dynamic'
                          ? 'freigeben'
                          : 'löschen'}"
                        title={lease.type === 'Dynamic' ? 'Freigeben' : 'Löschen'}
                        onclick={() =>
                          lease.type === 'Dynamic' ? releaseLease(lease) : removeLease(lease)}
                      >
                        <UiIcon name="trash" size={15} />
                      </button>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan="7" class="px-4 py-10 text-center text-fg-muted">
                    {leases.length === 0 ? 'Es gibt noch keine Leases.' : 'Keine Leases gefunden.'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <table class="w-full min-w-[44rem] text-left text-sm">
            <caption class="sr-only">DHCP-Reservierungen</caption>
            <thead class="border-b border-line text-xs text-fg-muted">
              <tr>
                <th class="px-4 py-2 font-medium">IP-Adresse</th>
                <th class="px-2 py-2 font-medium">Hostname</th>
                <th class="px-2 py-2 font-medium">MAC</th>
                <th class="px-2 py-2 font-medium">Kommentar</th>
                <th class="px-2 py-2 font-medium">Scope</th>
                <th class="w-20 px-2 py-2"><span class="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each reservationRows as r (r.scope + r.hardwareAddress)}
                <tr>
                  <td class="px-4 py-2 font-mono text-[13px]">{r.address}</td>
                  <td class="max-w-48 truncate px-2 py-2" title={r.hostName ?? ''}
                    >{r.hostName ?? '–'}</td
                  >
                  <td class="px-2 py-2 font-mono text-xs">{r.hardwareAddress}</td>
                  <td class="max-w-64 truncate px-2 py-2 text-fg-muted" title={r.comments ?? ''}
                    >{r.comments ?? ''}</td
                  >
                  <td class="px-2 py-2 text-fg-muted">{r.scope}</td>
                  <td class="px-2 py-1 text-right whitespace-nowrap">
                    {#if auth.isAdmin}
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Reservierung {r.address} bearbeiten"
                        onclick={() => (form = { open: true, existing: r, initial: null })}
                      >
                        <UiIcon name="pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn hover:text-down"
                        aria-label="Reservierung {r.address} löschen"
                        onclick={() => removeReservation(r)}
                      >
                        <UiIcon name="trash" size={15} />
                      </button>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan="6" class="px-4 py-10 text-center text-fg-muted">
                    {reservations.length === 0
                      ? 'Es gibt noch keine Reservierungen.'
                      : 'Keine Reservierungen gefunden.'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <p class="text-xs text-fg-muted">
        {tab === 'leases' ? leaseRows.length : reservationRows.length} Einträge
      </p>
    </section>
  {/if}
</div>

<ReservationForm
  open={form.open}
  {scopes}
  existing={form.existing}
  initial={form.initial}
  onclose={() => (form.open = false)}
  onsubmit={saveReservation}
/>
<ConfirmDialog
  open={confirm.open}
  title={confirm.title}
  message={confirm.message}
  confirmLabel={confirm.label}
  onclose={() => (confirm.open = false)}
  onconfirm={confirm.action}
/>

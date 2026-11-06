<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type {
    IpamAddressUsage,
    IpamData,
    IpamNetwork,
    IpamNetworkUsage,
    IpamRange,
    IpamScanStatus,
    IpamSync,
    IpamUsage,
  } from '@ultimate-dash/shared';
  import { ipv4RangeSize, ipv4ToInt, parseCidr } from '@ultimate-dash/shared';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { formatAgo, formatPercent } from '$lib/format';
  import { buildCells, categoryColor } from '$lib/ipam';
  import { theme } from '$lib/theme.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import CategoriesDialog from '$lib/components/CategoriesDialog.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import IpGrid from '$lib/components/IpGrid.svelte';
  import IpPanel from '$lib/components/IpPanel.svelte';
  import NetworkForm from '$lib/components/NetworkForm.svelte';
  import HostDialog from '$lib/components/HostDialog.svelte';
  import ReachDot from '$lib/components/ReachDot.svelte';
  import ScanDialog from '$lib/components/ScanDialog.svelte';
  import SyncPanel from '$lib/components/SyncPanel.svelte';
  import RangeForm from '$lib/components/RangeForm.svelte';
  import TechNav from '$lib/components/TechNav.svelte';
  import UiIcon from '$lib/components/UiIcon.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';

  let data = $state<IpamData>({ networks: [], categories: [], ranges: [] });
  let usage = $state<IpamUsage>({ available: true, reason: null, networks: {} });
  let sync = $state<IpamSync>({ available: false, reason: null, suggestions: [], drift: [] });
  let scan = $state<IpamScanStatus | null>(null);
  let scanOpen = $state(false);
  let hostForm = $state<{ open: boolean; row: IpamAddressUsage | null }>({
    open: false,
    row: null,
  });
  let filter = $state<'all' | 'discovered' | 'offline'>('all');
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let refreshing = $state(false);

  let networkForm = $state<{ open: boolean; existing: IpamNetwork | null }>({
    open: false,
    existing: null,
  });
  let rangeForm = $state<{ open: boolean; existing: IpamRange | null }>({
    open: false,
    existing: null,
  });
  let categoriesOpen = $state(false);
  let confirm = $state<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', action: async () => {} });
  let query = $state('');

  // Adresse im Seitenfenster; steht in der URL (?ip=), damit Links und Zurück-Taste funktionieren.
  const panelAddress = $derived(page.url.searchParams.get('ip'));
  let panelVersion = $state(0);
  function openPanel(address: string | null) {
    const url = new URL(page.url);
    if (address) url.searchParams.set('ip', address);
    else url.searchParams.delete('ip');
    void goto(url, { keepFocus: true, noScroll: true, replaceState: true });
  }

  const selectedId = $derived(Number(page.url.searchParams.get('net')) || null);
  const network = $derived(data.networks.find((n) => n.id === selectedId) ?? null);
  const netUsage = $derived<IpamNetworkUsage | null>(
    network ? (usage.networks[network.id] ?? null) : null,
  );
  const netRanges = $derived(network ? data.ranges.filter((r) => r.networkId === network.id) : []);
  const categoryOf = (id: number) => data.categories.find((c) => c.id === id);

  const GRID_LIMIT = 1024;
  const cells = $derived(
    network && (parseCidr(network.cidr)?.size ?? Infinity) <= GRID_LIMIT
      ? buildCells(network, data.ranges, data.categories, netUsage)
      : [],
  );

  const rows = $derived(
    (netUsage?.addresses ?? []).filter((a) => {
      if (filter === 'discovered' && !a.discovered) return false;
      if (filter === 'offline' && a.alive !== false) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        a.address.includes(q) ||
        a.claims.some((c) => c.name?.toLowerCase().includes(q) || c.mac?.toLowerCase().includes(q))
      );
    }),
  );
  const rangeOf = (address: string): IpamRange | undefined => {
    const n = ipv4ToInt(address)!;
    return netRanges.find((r) => n >= ipv4ToInt(r.startAddress)! && n <= ipv4ToInt(r.endAddress)!);
  };

  /** Ein Durchlauf auf Abruf; wir fragen den Stand ab, bis er fertig ist, und laden dann neu. */
  async function runScan() {
    try {
      scan = await api.runIpamScan();
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Scan konnte nicht starten', 'error');
      return;
    }
    for (let i = 0; i < 300 && scan?.running; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      scan = await api.ipamScan().catch(() => scan);
    }
    if (scan?.lastError) toasts.show(scan.lastError, 'error');
    else toasts.show('Scan abgeschlossen');
    await load();
  }

  async function acknowledge(values: { name: string }) {
    const row = hostForm.row;
    const hostId = row?.claims.find((c) => c.hostId !== null)?.hostId;
    if (!row || !hostId) return;
    await api.updateIpamHost(hostId, { ...values, acknowledged: true });
    toasts.show(row.discovered ? 'Gerät bestätigt' : 'Gerät gespeichert');
    hostForm.open = false;
    await load();
  }

  const forget = (row: IpamAddressUsage) =>
    ask(
      'Gerät vergessen?',
      `${row.address} wird aus der Liste entfernt. Antwortet es beim nächsten Scan wieder, erscheint es erneut als entdeckt.`,
      () => api.deleteIpamHost(row.claims.find((c) => c.hostId !== null)!.hostId!),
      'Gerät vergessen',
    );

  async function load(initial = false) {
    refreshing = !initial;
    try {
      [data, usage] = await Promise.all([api.ipam(), api.ipamUsage()]);
      // Der Abgleich ist nur für Admins sichtbar und darf die Seite nicht blockieren.
      sync = auth.isAdmin
        ? await api.ipamSync().catch(() => sync)
        : { available: false, reason: null, suggestions: [], drift: [] };
      scan = await api.ipamScan().catch(() => scan);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'IPAM-Daten konnten nicht geladen werden';
    } finally {
      loaded = true;
      refreshing = false;
    }
  }
  onMount(() => void load(true));

  const open = (id: number | null) =>
    void goto(id ? `/ipam?net=${id}` : '/ipam', { keepFocus: true });

  async function importScopes(scopes: string[], withPoolRange: boolean) {
    try {
      const created = await api.importIpam({ scopes, withPoolRange });
      toasts.show(created.length === 1 ? 'Netz übernommen' : `${created.length} Netze übernommen`);
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Übernehmen fehlgeschlagen', 'error');
    }
    await load();
  }

  const drift = $derived(sync.drift.filter((d) => d.networkId === network?.id));

  async function adoptGateway(gateway: string) {
    if (!network) return;
    try {
      await api.updateIpamNetwork(network.id, { ...network, gateway });
      toasts.show('Gateway übernommen');
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Übernehmen fehlgeschlagen', 'error');
    }
    await load();
  }

  async function saveNetwork(values: Parameters<typeof api.createIpamNetwork>[0]) {
    const existing = networkForm.existing;
    const saved = existing
      ? await api.updateIpamNetwork(existing.id, values)
      : await api.createIpamNetwork(values);
    toasts.show(existing ? 'Netz gespeichert' : 'Netz angelegt');
    networkForm.open = false;
    await load();
    if (!existing) open(saved.id);
  }

  async function saveRange(values: {
    categoryId: number;
    startAddress: string;
    endAddress: string;
    label: string;
  }) {
    const existing = rangeForm.existing;
    const input = { ...values, networkId: network!.id };
    if (existing) await api.updateIpamRange(existing.id, input);
    else await api.createIpamRange(input);
    toasts.show(existing ? 'Bereich gespeichert' : 'Bereich angelegt');
    rangeForm.open = false;
    await load();
  }

  function ask(title: string, message: string, action: () => Promise<unknown>, success: string) {
    confirm = {
      open: true,
      title,
      message,
      action: async () => {
        try {
          await action();
          toasts.show(success);
        } catch (e) {
          toasts.show(e instanceof Error ? e.message : 'Aktion fehlgeschlagen', 'error');
        }
        confirm.open = false;
        await load();
      },
    };
  }

  const removeNetwork = (n: IpamNetwork) =>
    ask(
      'Netz löschen?',
      `${n.name} (${n.cidr}) und alle IP-Bereiche darin werden gelöscht. In Technitium ändert sich nichts.`,
      async () => {
        await api.deleteIpamNetwork(n.id);
        open(null);
      },
      'Netz gelöscht',
    );

  const removeRange = (r: IpamRange) =>
    ask(
      'Bereich löschen?',
      `${r.startAddress} – ${r.endAddress} wird entfernt.`,
      () => api.deleteIpamRange(r.id),
      'Bereich gelöscht',
    );

  /** Belegung je Kategorie eines Netzes: Kapazität und davon belegt. */
  function breakdown(n: IpamNetwork) {
    const u = usage.networks[n.id];
    const hosts = (parseCidr(n.cidr)?.size ?? 2) - 2;
    const parts = data.ranges
      .filter((r) => r.networkId === n.id)
      .map((r) => ({
        key: r.id,
        category: categoryOf(r.categoryId),
        size: ipv4RangeSize(r.startAddress, r.endAddress),
        used: u?.rangeUse[r.id]?.used ?? 0,
      }));
    const assigned = parts.reduce((sum, p) => sum + p.size, 0);
    return { hosts, parts, unassigned: Math.max(0, hosts - assigned), u };
  }

  const typeLabel = { reservation: 'Reservierung', lease: 'Lease', static: 'Statisch' } as const;
  const sourceLabel = {
    lease: 'DHCP-Lease',
    reservation: 'DHCP-Reservierung',
    dns: 'DNS',
    discovered: 'Ping',
    manual: 'Von Hand',
  } as const;
</script>

{#snippet scanInfo()}
  {#if scan}
    <p class="text-xs text-fg-muted" role="status">
      {#if scan.running}
        Ping-Prüfung läuft gerade …
      {:else if !scan.enabled}
        Ping-Prüfung ist aus.
      {:else if scan.lastRunAt}
        Letzte Ping-Prüfung {formatAgo(scan.lastRunAt)}, danach alle {scan.intervalMinutes} Min.
      {:else}
        Die erste Ping-Prüfung läuft kurz nach dem Start des Servers.
      {/if}
    </p>
  {/if}
{/snippet}

{#snippet usageBar(n: IpamNetwork)}
  {@const b = breakdown(n)}
  <div
    class="flex h-3 w-full gap-0.5"
    role="img"
    aria-label="Belegung von {n.name}: {b.u?.used ?? 0} von {b.hosts} Adressen"
  >
    {#each b.parts as part (part.key)}
      <div
        class="relative h-full min-w-1 overflow-hidden rounded-sm"
        style="flex: {part.size} 1 0; background: color-mix(in srgb, {part.category
          ? categoryColor(part.category.color)
          : 'var(--text-muted)'} 22%, transparent)"
      >
        <div
          class="h-full"
          style="width: {part.size ? (part.used / part.size) * 100 : 0}%; background: {part.category
            ? categoryColor(part.category.color)
            : 'var(--text-muted)'}"
        ></div>
      </div>
    {/each}
    {#if b.unassigned > 0}
      <div class="h-full rounded-sm bg-muted" style="flex: {b.unassigned} 1 0"></div>
    {/if}
  </div>
{/snippet}

<div class="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
  <header class="flex flex-wrap items-center gap-3">
    <a href="/" class="icon-btn" aria-label="Zurück zum Dashboard"><UiIcon name="back" /></a>
    <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
      <UiIcon name="layout" size={20} class="text-fg-muted" /> IPAM
    </h1>
    <TechNav />
    <div class="ml-auto flex items-center gap-1">
      {#if auth.isAdmin}
        <button type="button" class="btn" disabled={scan?.running} onclick={runScan}>
          <UiIcon name="refresh" size={16} class={scan?.running ? 'animate-spin' : ''} />
          {scan?.running ? 'Scannt …' : 'Jetzt scannen'}
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Ping-Prüfung einstellen"
          title="Ping-Prüfung einstellen"
          onclick={() => (scanOpen = true)}
        >
          <UiIcon name="settings" size={16} />
        </button>
      {/if}
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

  {#if error && !loaded}
    <div
      class="mx-auto max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
      role="alert"
    >
      <p class="font-medium">IPAM-Daten konnten nicht geladen werden.</p>
      <p class="mt-1 text-sm text-fg-muted">{error}</p>
      <button type="button" class="btn mt-4" onclick={() => load(true)}>Erneut versuchen</button>
    </div>
  {:else if !loaded}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Lädt">
      {#each Array(2) as _, i (i)}<div class="h-36 animate-pulse rounded-2xl bg-muted"></div>{/each}
    </div>
  {:else}
    {#if !usage.available}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm" role="status">
        Die Belegung ist gerade nicht verfügbar{usage.reason ? `: ${usage.reason}` : ''}
        Netze und Bereiche lassen sich trotzdem pflegen.
      </p>
    {/if}

    {#if !network}
      <!-- Übersicht -->
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-semibold">Netze</h2>
        <div class="min-w-0">{@render scanInfo()}</div>
        {#if auth.isAdmin}
          <div class="ml-auto flex gap-2">
            <button type="button" class="btn" onclick={() => (categoriesOpen = true)}>
              Kategorien
            </button>
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => (networkForm = { open: true, existing: null })}
            >
              <UiIcon name="plus" size={16} /> Netz
            </button>
          </div>
        {/if}
      </div>

      {#if auth.isAdmin && sync.suggestions.length > 0}
        <SyncPanel suggestions={sync.suggestions} onimport={importScopes} />
      {/if}

      {#if data.networks.length === 0 && sync.suggestions.length === 0}
        <div class="mx-auto max-w-md rounded-2xl border border-dashed border-line p-6 text-center">
          <p class="font-medium">Noch keine Netze.</p>
          <p class="mt-1 text-sm text-fg-muted">
            {auth.isAdmin
              ? 'Lege ein Netz wie 10.10.10.0/24 an und teile es in Kategorien wie Server, Clients oder IoT ein. Die Belegung kommt aus Technitium.'
              : 'Ein Administrator kann Netze anlegen.'}
          </p>
        </div>
      {:else}
        <section aria-label="Netze" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {#each data.networks as n (n.id)}
            {@const b = breakdown(n)}
            <a
              href="/ipam?net={n.id}"
              class="grid content-start gap-3 rounded-2xl border border-line bg-elevated p-4 transition hover:border-accent"
            >
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <h3 class="truncate font-semibold">{n.name}</h3>
                  <p class="font-mono text-xs text-fg-muted">{n.cidr}</p>
                </div>
                {#if n.vlanId}
                  <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
                    >VLAN {n.vlanId}</span
                  >
                {/if}
              </div>
              {@render usageBar(n)}
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                {#if b.u}
                  <span class="tabular-nums"
                    ><span class="font-semibold">{b.u.used}</span> von {b.hosts} belegt ({formatPercent(
                      b.u.used,
                      b.hosts,
                    )})</span
                  >
                  {#if b.u.discovered > 0}
                    <span class="font-medium" style="color: var(--discovered)"
                      >{b.u.discovered} neu entdeckt</span
                    >
                  {/if}
                  {#if b.u.conflicts > 0}
                    <span class="font-medium text-down"
                      >{b.u.conflicts} Konflikt{b.u.conflicts > 1 ? 'e' : ''}</span
                    >
                  {/if}
                {:else}
                  <span class="text-fg-muted">{b.hosts} Adressen</span>
                {/if}
              </div>
              {#if b.parts.length > 0}
                <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  {#each new Set(b.parts
                      .map((p) => p.category)
                      .filter((c) => !!c)) as category (category!.id)}
                    <li class="flex items-center gap-1.5">
                      <span
                        class="size-2.5 rounded-sm"
                        style="background: {categoryColor(category!.color)}"
                      ></span>
                      {category!.name}
                    </li>
                  {/each}
                </ul>
              {/if}
            </a>
          {/each}
        </section>
      {/if}
    {:else}
      <!-- Netz im Detail -->
      {@const cidr = parseCidr(network.cidr)}
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn" onclick={() => open(null)}>
          <UiIcon name="back" size={16} /> Alle Netze
        </button>
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold">{network.name}</h2>
          <p class="text-xs text-fg-muted">
            <span class="font-mono">{network.cidr}</span>
            {#if network.vlanId}· VLAN {network.vlanId}{/if}
            {#if network.gateway}· Gateway <span class="font-mono">{network.gateway}</span>{/if}
            {#if network.description}· {network.description}{/if}
          </p>
        </div>
        {#if auth.isAdmin}
          <div class="ml-auto flex gap-2">
            <button
              type="button"
              class="btn"
              onclick={() => (networkForm = { open: true, existing: network })}
            >
              <UiIcon name="pencil" size={16} /> Bearbeiten
            </button>
            <button type="button" class="btn text-down" onclick={() => removeNetwork(network)}>
              <UiIcon name="trash" size={16} /> Löschen
            </button>
          </div>
        {/if}
      </div>

      {#each drift as d (d.field)}
        <p
          class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm"
          role="status"
        >
          <span>
            In Technitium (Scope {d.scope}) ist <span class="font-mono">{d.remote}</span> als
            Gateway eingetragen, hier {d.local ? '' : 'steht keins'}{#if d.local}<span
                class="font-mono">{d.local}</span
              >{/if}.
          </span>
          <button type="button" class="btn ml-auto" onclick={() => adoptGateway(d.remote)}>
            Übernehmen
          </button>
        </p>
      {/each}

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section
          aria-label="Adressraster"
          class="grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-elevated p-4"
        >
          {#if netUsage}
            <p class="text-sm tabular-nums">
              <span class="font-semibold">{netUsage.used}</span> von {netUsage.hosts} Adressen belegt
              ({formatPercent(netUsage.used, netUsage.hosts)})
              {#if netUsage.lastScanAt}
                · {netUsage.online} online
              {/if}
              {#if netUsage.discovered > 0}
                · <span class="font-medium" style="color: var(--discovered)"
                  >{netUsage.discovered} neu entdeckt</span
                >
              {/if}
              {#if netUsage.conflicts > 0}
                · <span class="font-medium text-down"
                  >{netUsage.conflicts} Konflikt{netUsage.conflicts > 1 ? 'e' : ''}</span
                >
              {/if}
            </p>
          {/if}
          {@render scanInfo()}
          {#if cells.length > 0}
            <IpGrid
              {cells}
              label="Adressen von {network.name}"
              selected={panelAddress}
              onpick={(cell) => {
                if (cell.kind !== 'network' && cell.kind !== 'broadcast') openPanel(cell.address);
              }}
            />
          {:else if cidr}
            <p class="text-sm text-fg-muted">
              Das Raster gibt es für Netze bis /22. Die belegten Adressen stehen in der Liste.
            </p>
          {/if}
        </section>

        <section
          aria-label="IP-Bereiche"
          class="grid min-w-0 content-start gap-3 rounded-2xl border border-line bg-elevated p-4"
        >
          <div class="flex items-center gap-2">
            <h3 class="font-semibold">IP-Bereiche</h3>
            {#if auth.isAdmin}
              <div class="ml-auto flex gap-2">
                <button type="button" class="btn" onclick={() => (categoriesOpen = true)}>
                  Kategorien
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={data.categories.length === 0}
                  title={data.categories.length === 0 ? 'Lege zuerst eine Kategorie an' : undefined}
                  onclick={() => (rangeForm = { open: true, existing: null })}
                >
                  <UiIcon name="plus" size={16} /> Bereich
                </button>
              </div>
            {/if}
          </div>
          {#if netRanges.length === 0}
            <p class="text-sm text-fg-muted">
              Noch keine Bereiche. Teile das Netz in Bereiche je Kategorie ein, etwa „Server .2 –
              .49“ und „Clients .100 – .199“.
            </p>
          {:else}
            <div class="relative overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs text-fg-muted">
                  <tr>
                    <th class="py-1 pr-3 font-medium">Kategorie</th>
                    <th class="py-1 pr-3 font-medium">Bereich</th>
                    <th class="py-1 pr-3 text-right font-medium">Belegt</th>
                    <th class="py-1"><span class="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody>
                  {#each netRanges as r (r.id)}
                    {@const cat = categoryOf(r.categoryId)}
                    {@const u = netUsage?.rangeUse[r.id]}
                    <tr class="border-t border-line">
                      <td class="py-2 pr-3">
                        <span class="flex items-center gap-2">
                          <span
                            class="size-3 shrink-0 rounded-sm"
                            style="background: {cat ? categoryColor(cat.color) : 'var(--unknown)'}"
                          ></span>
                          <span class="min-w-0">
                            <span class="block truncate">{cat?.name ?? '–'}</span>
                            {#if r.label}<span class="block truncate text-xs text-fg-muted"
                                >{r.label}</span
                              >{/if}
                          </span>
                        </span>
                      </td>
                      <td class="py-2 pr-3 font-mono text-xs whitespace-nowrap"
                        >{r.startAddress} – {r.endAddress}</td
                      >
                      <td class="py-2 pr-3 text-right text-xs whitespace-nowrap tabular-nums">
                        {#if u}{u.used} / {u.size}{:else}{ipv4RangeSize(
                            r.startAddress,
                            r.endAddress,
                          )}{/if}
                      </td>
                      <td class="py-2 text-right whitespace-nowrap">
                        {#if auth.isAdmin}
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Bereich {r.startAddress} bearbeiten"
                            onclick={() => (rangeForm = { open: true, existing: r })}
                          >
                            <UiIcon name="pencil" size={16} />
                          </button>
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Bereich {r.startAddress} löschen"
                            onclick={() => removeRange(r)}
                          >
                            <UiIcon name="trash" size={16} />
                          </button>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#if netUsage && netUsage.unassignedUsed > 0}
              <p class="text-xs text-fg-muted">
                {netUsage.unassignedUsed} belegte Adresse{netUsage.unassignedUsed > 1
                  ? 'n liegen'
                  : ' liegt'} in keinem Bereich.
              </p>
            {/if}
          {/if}
        </section>
      </div>

      <section aria-label="Belegte Adressen" class="grid min-w-0 gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <h3 class="font-semibold">Belegte Adressen</h3>
          <div class="flex gap-1" role="group" aria-label="Filter">
            {#each [['all', 'Alle'], ['discovered', `Entdeckt${netUsage?.discovered ? ` (${netUsage.discovered})` : ''}`], ['offline', 'Offline']] as [value, text] (value)}
              <button
                type="button"
                class="btn px-2.5 py-1 text-xs"
                class:bg-muted={filter === value}
                aria-pressed={filter === value}
                onclick={() => (filter = value as typeof filter)}>{text}</button
              >
            {/each}
          </div>
          <div class="relative ml-auto w-full sm:w-64">
            <UiIcon
              name="search"
              size={16}
              class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
            />
            <input
              class="input pl-9"
              type="search"
              placeholder="Adresse, Name oder MAC"
              aria-label="Belegte Adressen durchsuchen"
              bind:value={query}
            />
          </div>
        </div>
        {#if !netUsage}
          <p class="text-sm text-fg-muted">Ohne Verbindung zu Technitium gibt es keine Belegung.</p>
        {:else if rows.length === 0}
          <p class="text-sm text-fg-muted">
            {query || filter !== 'all'
              ? 'Keine Treffer.'
              : 'Keine belegten Adressen in diesem Netz.'}
          </p>
        {:else}
          <div class="relative overflow-x-auto rounded-2xl border border-line bg-elevated">
            <table class="w-full text-left text-sm">
              <thead class="text-xs text-fg-muted">
                <tr class="border-b border-line">
                  <th class="px-3 py-2 font-medium">Adresse</th>
                  <th class="px-3 py-2 font-medium">Name</th>
                  <th class="px-3 py-2 font-medium">Typ</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Quelle</th>
                  <th class="px-3 py-2 font-medium">MAC</th>
                  <th class="px-3 py-2 font-medium">Kategorie</th>
                  <th class="px-3 py-2"><span class="sr-only">Aktionen</span></th>
                </tr>
              </thead>
              <tbody>
                {#each rows as row (row.address)}
                  {@const cat = categoryOf(rangeOf(row.address)?.categoryId ?? 0)}
                  <tr
                    class="border-t border-line align-top"
                    class:bg-muted={panelAddress === row.address}
                    style={row.discovered ? 'background: var(--discovered-bg)' : ''}
                  >
                    <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <button
                        type="button"
                        class="font-mono text-xs text-accent hover:underline"
                        aria-label="Details zu {row.address} öffnen"
                        onclick={() => openPanel(row.address)}>{row.address}</button
                      >
                      {#if row.conflict}<span class="ml-1 font-sans font-semibold text-down"
                          >Konflikt</span
                        >{/if}
                    </td>
                    <td class="px-3 py-2">
                      {#each [...new Set(row.claims
                            .map((c) => c.name)
                            .filter(Boolean))] as name (name)}
                        <span class="block">{name}</span>
                      {:else}–{/each}
                    </td>
                    <td class="px-3 py-2 whitespace-nowrap">
                      {typeLabel[row.type]}
                      {#if row.discovered}
                        <span
                          class="ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                          style="color: var(--discovered); border: 1px solid var(--discovered)"
                          >Entdeckt</span
                        >
                      {/if}
                    </td>
                    <td class="px-3 py-2"><ReachDot alive={row.alive} lastSeen={row.lastSeen} /></td
                    >
                    <td class="px-3 py-2 whitespace-nowrap text-fg-muted">
                      {[...new Set(row.claims.map((c) => sourceLabel[c.source]))].join(', ')}
                    </td>
                    <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {#each [...new Set(row.claims
                            .map((c) => c.mac)
                            .filter(Boolean))] as mac (mac)}
                        <span class="block">{mac}</span>
                      {:else}–{/each}
                    </td>
                    <td class="px-3 py-2 whitespace-nowrap">
                      {#if cat}
                        <span class="flex items-center gap-2">
                          <span
                            class="size-2.5 rounded-sm"
                            style="background: {categoryColor(cat.color)}"
                          ></span>
                          {cat.name}
                        </span>
                      {:else}<span class="text-fg-muted">–</span>{/if}
                    </td>
                    <td class="px-3 py-2 text-right whitespace-nowrap">
                      {#if auth.isAdmin && row.claims.some((c) => c.hostId !== null)}
                        <button
                          type="button"
                          class="btn px-2.5 py-1 text-xs"
                          aria-label="{row.address} {row.discovered ? 'bestätigen' : 'bearbeiten'}"
                          onclick={() => (hostForm = { open: true, row })}
                          >{row.discovered ? 'Bestätigen' : 'Bearbeiten'}</button
                        >
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="{row.address} vergessen"
                          onclick={() => forget(row)}
                        >
                          <UiIcon name="trash" size={16} />
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

{#if panelAddress && network}
  <IpPanel
    address={panelAddress}
    {network}
    categories={data.categories}
    version={panelVersion}
    onclose={() => openPanel(null)}
    onchanged={() => load()}
  />
{/if}

<ScanDialog
  open={scanOpen}
  status={scan}
  onclose={() => (scanOpen = false)}
  onchanged={() => load()}
/>
{#if hostForm.row}
  <HostDialog
    open={hostForm.open}
    address={hostForm.row.address}
    name={hostForm.row.claims.find((c) => c.hostId !== null)?.name ?? null}
    confirmed={!hostForm.row.discovered}
    onclose={() => (hostForm.open = false)}
    onsubmit={acknowledge}
  />
{/if}
<NetworkForm
  open={networkForm.open}
  existing={networkForm.existing}
  onclose={() => (networkForm.open = false)}
  onsubmit={saveNetwork}
/>
{#if network}
  <RangeForm
    open={rangeForm.open}
    {network}
    categories={data.categories}
    existing={rangeForm.existing}
    onclose={() => (rangeForm.open = false)}
    onsubmit={saveRange}
  />
{/if}
<CategoriesDialog
  open={categoriesOpen}
  categories={data.categories}
  ranges={data.ranges}
  onclose={() => (categoriesOpen = false)}
  onchanged={() => load()}
/>
<ConfirmDialog
  open={confirm.open}
  title={confirm.title}
  message={confirm.message}
  onclose={() => (confirm.open = false)}
  onconfirm={confirm.action}
/>

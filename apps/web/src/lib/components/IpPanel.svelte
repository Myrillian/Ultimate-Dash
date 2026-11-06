<script lang="ts">
  import type {
    DhcpScope,
    DnsRecord,
    IpamCategory,
    IpamIpDetail,
    IpamNetwork,
  } from '@ultimate-dash/shared';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { fullName, type RecordFormValues } from '$lib/dns-records';
  import { categoryColor } from '$lib/ipam';
  import { toasts } from '$lib/toasts.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import ConvertLeaseDialog, { type ConvertValues } from './ConvertLeaseDialog.svelte';
  import HostDialog from './HostDialog.svelte';
  import RecordForm from './RecordForm.svelte';
  import ReservationForm, { type ReservationValues } from './ReservationForm.svelte';
  import ReachDot from './ReachDot.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    address: string;
    network: IpamNetwork | null;
    categories: IpamCategory[];
    /** Wird bei jeder Änderung hochgezählt, damit das Fenster neu lädt. */
    version?: number;
    onclose: () => void;
    /** Nach einer Änderung in Technitium oder im IPAM: Seite soll neu laden. */
    onchanged?: () => void;
  }
  let { address, network, categories, version = 0, onclose, onchanged }: Props = $props();

  let detail = $state<IpamIpDetail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    const current = address;
    void version;
    void reload;
    loading = true;
    error = null;
    let stale = false;
    api
      .ipamIp(current)
      .then((d) => {
        if (!stale) detail = d;
      })
      .catch((e) => {
        if (!stale) {
          detail = null;
          error = e instanceof Error ? e.message : 'Laden fehlgeschlagen';
        }
      })
      .finally(() => {
        if (!stale) loading = false;
      });
    return () => (stale = true);
  });

  $effect(() => {
    void address;
    closeButton?.focus();
  });

  // ---- Aktionen (nur Admins) ----
  let scopes = $state<DhcpScope[]>([]);
  let zones = $state<string[]>([]);
  let reload = $state(0);

  $effect(() => {
    if (!auth.isAdmin) return;
    void api
      .dhcpScopes()
      .then((s) => (scopes = s))
      .catch(() => undefined);
    void api
      .dnsZones()
      .then(
        (z) =>
          (zones = z
            .filter(
              (x) =>
                !x.internal &&
                !x.disabled &&
                !x.name.endsWith('.arpa') &&
                /^Primary$/i.test(x.type),
            )
            .map((x) => x.name)),
      )
      .catch(() => undefined);
  });

  const scopeDomain = $derived(
    scopes.find((s) => s.name === (detail?.dhcp.pool?.scope ?? detail?.dhcp.lease?.scope))
      ?.domainName ?? null,
  );

  let confirm = $state<{
    open: boolean;
    title: string;
    message: string;
    label: string;
    action: () => Promise<unknown>;
    success: string;
  }>({ open: false, title: '', message: '', label: '', action: async () => {}, success: '' });
  let convertOpen = $state(false);
  let reservationOpen = $state(false);
  let hostOpen = $state(false);
  let recordForm = $state<{
    open: boolean;
    zone: string;
    record: DnsRecord | null;
    initial: { name: string; ipAddress: string; type: 'A'; createPtr: boolean } | null;
  }>({ open: false, zone: '', record: null, initial: null });
  let newRecordZone = $state('');

  $effect(() => {
    if (!newRecordZone || !zones.includes(newRecordZone))
      newRecordZone = scopeDomain && zones.includes(scopeDomain) ? scopeDomain : (zones[0] ?? '');
  });

  function changed() {
    reload++;
    onchanged?.();
  }

  function ask(
    title: string,
    message: string,
    label: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    confirm = { open: true, title, message, label, action, success };
  }

  async function runConfirm() {
    try {
      await confirm.action();
      toasts.show(confirm.success);
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Aktion fehlgeschlagen', 'error');
    }
    confirm.open = false;
    changed();
  }

  const releaseLease = () => {
    const l = detail!.dhcp.lease!;
    ask(
      'Lease freigeben?',
      `${address}${l.hostName ? ` (${l.hostName})` : ''} wird freigegeben. Das Gerät bekommt beim nächsten Erneuern eine Adresse, möglicherweise dieselbe.`,
      'Freigeben',
      () => api.dhcpLeaseAction({ scope: l.scope, hardwareAddress: l.mac, action: 'remove' }),
      'Lease freigegeben',
    );
  };

  /** Lease → Reservierung, dann Name/Kommentar, dann optional DNS; bei Fehlern wird zurückgenommen. */
  async function convertLease(values: ConvertValues) {
    const l = detail!.dhcp.lease!;
    await api.dhcpLeaseAction({ scope: l.scope, hardwareAddress: l.mac, action: 'reserve' });
    try {
      await api.updateDhcpReservation({
        scope: l.scope,
        hardwareAddress: l.mac,
        currentHardwareAddress: l.mac,
        ipAddress: address,
        hostName: values.hostName,
        comments: values.comments,
      });
      if (values.dns && values.hostName.trim()) {
        await api.addDnsRecord({
          zone: values.zone,
          domain: fullName(values.hostName, values.zone),
          ttl: 3600,
          comments: '',
          createPtr: values.createPtr,
          data: { type: 'A', ipAddress: address },
        });
      }
    } catch (error) {
      await api
        .dhcpLeaseAction({ scope: l.scope, hardwareAddress: l.mac, action: 'unreserve' })
        .catch(() => undefined);
      throw new Error(
        `${error instanceof Error ? error.message : 'Fehler'} – die Reservierung wurde zurückgenommen.`,
      );
    }
    toasts.show(`${address} reserviert`);
    convertOpen = false;
    changed();
  }

  async function saveReservation(values: ReservationValues) {
    const current = detail!.dhcp.reservation!;
    await api.updateDhcpReservation({
      scope: values.scope,
      hardwareAddress: values.hardwareAddress,
      ipAddress: values.ipAddress.trim(),
      hostName: values.hostName,
      comments: values.comments,
      currentHardwareAddress: current.mac,
    });
    toasts.show('Reservierung gespeichert');
    reservationOpen = false;
    changed();
  }

  const deleteReservation = () => {
    const r = detail!.dhcp.reservation!;
    ask(
      'Reservierung löschen?',
      `${address}${r.hostName ? ` (${r.hostName})` : ''} für ${r.mac} wird gelöscht. DNS-Einträge bleiben bestehen.`,
      'Löschen',
      () => api.deleteDhcpReservation({ scope: r.scope, hardwareAddress: r.mac }),
      'Reservierung gelöscht',
    );
  };

  const unreserve = () => {
    const r = detail!.dhcp.reservation!;
    ask(
      'Reservierung aufheben?',
      `${address} wird wieder zu einer normalen, dynamischen Lease. Voraussetzung ist, dass das Gerät gerade eine Lease hat.`,
      'Aufheben',
      () => api.dhcpLeaseAction({ scope: r.scope, hardwareAddress: r.mac, action: 'unreserve' }),
      'Reservierung aufgehoben',
    );
  };

  async function editRecord(zone: string, domain: string) {
    try {
      const list = await api.dnsRecords(zone);
      const record = list.records.find(
        (r) =>
          r.type === 'A' &&
          r.domain.toLowerCase() === domain.toLowerCase() &&
          r.data?.type === 'A' &&
          r.data.ipAddress === address,
      );
      if (!record) throw new Error('Der Eintrag wurde in Technitium nicht gefunden.');
      recordForm = { open: true, zone, record, initial: null };
    } catch (e) {
      toasts.show(e instanceof Error ? e.message : 'Laden fehlgeschlagen', 'error');
    }
  }

  const newRecord = () =>
    (recordForm = {
      open: true,
      zone: newRecordZone,
      record: null,
      initial: {
        type: 'A',
        name: detail?.dhcp.reservation?.hostName ?? detail?.dhcp.lease?.hostName ?? '',
        ipAddress: address,
        createPtr: !!detail?.dns.reverseZone,
      },
    });

  async function saveRecord(values: RecordFormValues) {
    const current = recordForm.record;
    const input = { zone: recordForm.zone, ...values };
    if (current?.data) {
      await api.updateDnsRecord({
        ...input,
        current: { domain: current.domain, data: current.data },
      });
    } else {
      await api.addDnsRecord(input);
    }
    toasts.show(current ? 'Eintrag gespeichert' : 'Eintrag angelegt');
    recordForm.open = false;
    changed();
  }

  const deleteRecord = (zone: string, domain: string) =>
    ask(
      'DNS-Eintrag löschen?',
      `${domain} → ${address} wird aus Technitium gelöscht.`,
      'Löschen',
      () => api.deleteDnsRecord({ zone, domain, data: { type: 'A', ipAddress: address } }),
      'Eintrag gelöscht',
    );

  async function saveHost(values: { name: string }) {
    if (detail?.hostId == null) return;
    await api.updateIpamHost(detail.hostId, { ...values, acknowledged: true });
    toasts.show(detail.discovered ? 'Gerät bestätigt' : 'Gerät gespeichert');
    hostOpen = false;
    changed();
  }

  const forgetHost = () =>
    ask(
      'Gerät vergessen?',
      `${address} wird aus der Liste entfernt. Antwortet es beim nächsten Scan wieder, erscheint es erneut als entdeckt.`,
      'Vergessen',
      () => api.deleteIpamHost(detail!.hostId!),
      'Gerät vergessen',
    );

  const category = $derived(categories.find((c) => c.id === detail?.categoryId) ?? null);
  const typeLabel = { reservation: 'Reservierung', lease: 'Lease', static: 'Statisch' } as const;
  const isGateway = $derived(!!network?.gateway && network.gateway === address);

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<aside
  class="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-line bg-elevated shadow-2xl sm:w-[26rem]"
  aria-label="Details zu {address}"
>
  <header class="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
    <div class="min-w-0">
      <h2 class="font-mono text-lg font-semibold">{address}</h2>
      <p class="truncate text-sm text-fg-muted">
        {#if detail}
          {detail.state === 'free'
            ? isGateway
              ? 'Gateway des Netzes'
              : 'Frei'
            : detail.type
              ? typeLabel[detail.type]
              : ''}
          {#if detail.discovered}· Entdeckt{/if}
          {#if detail.conflict}· <span class="font-medium text-down">Konflikt</span>{/if}
        {:else if loading}Lädt …{/if}
      </p>
    </div>
    <button
      bind:this={closeButton}
      type="button"
      class="icon-btn shrink-0"
      aria-label="Seitenfenster schließen"
      onclick={onclose}
    >
      <UiIcon name="x" />
    </button>
  </header>

  <div class="grid flex-1 content-start gap-5 overflow-y-auto px-4 py-4 text-sm">
    {#if error}
      <p class="rounded-xl border border-down/40 p-3 text-down" role="alert">{error}</p>
    {:else if detail}
      <section aria-labelledby="ip-overview" class="grid gap-1.5">
        <h3 id="ip-overview" class="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Überblick
        </h3>
        <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
          <dt class="text-fg-muted">Netz</dt>
          <dd>{network ? `${network.name} (${network.cidr})` : '–'}</dd>
          <dt class="text-fg-muted">Kategorie</dt>
          <dd>
            {#if category}
              <span class="inline-flex items-center gap-2">
                <span
                  class="size-2.5 rounded-sm"
                  style="background: {categoryColor(category.color)}"
                ></span>
                {category.name}
              </span>
            {:else}–{/if}
          </dd>
          <dt class="text-fg-muted">Name</dt>
          <dd>
            {[
              ...new Set(
                [
                  detail.dhcp.reservation?.hostName,
                  detail.dhcp.lease?.hostName,
                  ...detail.dns.forward.map((f) => f.domain),
                  detail.hostName,
                ].filter(Boolean),
              ),
            ].join(', ') || '–'}
          </dd>
        </dl>
        {#if detail.state === 'free' && !isGateway}
          <p class="text-fg-muted">
            Diese Adresse ist weder im DHCP noch im DNS eingetragen und es kam keine Ping-Antwort.
          </p>
        {/if}
        {#if detail.conflict}
          <p class="rounded-xl border border-down/40 p-2.5 text-down">
            Mehrere Geräte (verschiedene MAC-Adressen) beanspruchen diese Adresse.
          </p>
        {/if}
      </section>

      <section aria-labelledby="ip-dhcp" class="grid gap-1.5">
        <h3 id="ip-dhcp" class="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          DHCP
        </h3>
        {#if detail.dhcp.pool}
          <p>
            Im Bereich von <span class="font-medium">{detail.dhcp.pool.scope}</span>{detail.dhcp
              .pool.excluded
              ? ' (ausgeschlossen)'
              : ''}{detail.dhcp.pool.enabled ? '' : ', Scope ist deaktiviert'}.
          </p>
        {:else}
          <p class="text-fg-muted">Liegt in keinem DHCP-Bereich.</p>
        {/if}
        {#if detail.dhcp.reservation}
          {@const r = detail.dhcp.reservation}
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
            <dt class="text-fg-muted">Reservierung</dt>
            <dd>{r.scope}</dd>
            <dt class="text-fg-muted">MAC</dt>
            <dd class="font-mono text-xs">{r.mac}</dd>
            <dt class="text-fg-muted">Hostname</dt>
            <dd>{r.hostName ?? '–'}</dd>
            <dt class="text-fg-muted">Kommentar</dt>
            <dd>{r.comment ?? '–'}</dd>
          </dl>
          {#if auth.isAdmin}
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn px-2.5 py-1 text-xs"
                onclick={() => (reservationOpen = true)}>Bearbeiten</button
              >
              <button type="button" class="btn px-2.5 py-1 text-xs" onclick={unreserve}
                >In Lease zurückwandeln</button
              >
              <button
                type="button"
                class="btn btn-danger px-2.5 py-1 text-xs"
                onclick={deleteReservation}>Löschen</button
              >
            </div>
          {/if}
        {/if}
        {#if detail.dhcp.lease}
          {@const l = detail.dhcp.lease}
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
            <dt class="text-fg-muted">Lease</dt>
            <dd>{l.scope}</dd>
            <dt class="text-fg-muted">MAC</dt>
            <dd class="font-mono text-xs">{l.mac}</dd>
            <dt class="text-fg-muted">Hostname</dt>
            <dd>{l.hostName ?? '–'}</dd>
            <dt class="text-fg-muted">Erhalten</dt>
            <dd>{l.obtained ?? '–'}</dd>
            <dt class="text-fg-muted">Läuft ab</dt>
            <dd>{l.expires ?? '–'}</dd>
          </dl>
          {#if auth.isAdmin}
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-primary px-2.5 py-1 text-xs"
                onclick={() => (convertOpen = true)}>In Reservierung umwandeln</button
              >
              <button type="button" class="btn px-2.5 py-1 text-xs" onclick={releaseLease}
                >Lease freigeben</button
              >
            </div>
            <p class="text-xs text-fg-muted">
              Eine laufende Lease lässt sich in Technitium nicht ändern, nur umwandeln oder
              freigeben.
            </p>
          {/if}
        {/if}
        {#if !detail.dhcp.reservation && !detail.dhcp.lease}
          <p class="text-fg-muted">Keine Reservierung und keine Lease.</p>
        {/if}
      </section>

      <section aria-labelledby="ip-dns" class="grid gap-1.5">
        <h3 id="ip-dns" class="text-xs font-semibold tracking-wide text-fg-muted uppercase">DNS</h3>
        {#if detail.dns.forward.length > 0}
          <ul class="grid gap-1">
            {#each detail.dns.forward as record (record.zone + record.domain)}
              <li>
                <span class="font-medium">{record.domain}</span>
                <span class="text-fg-muted">A · TTL {record.ttl} · Zone {record.zone}</span>
                {#if record.comment}<span class="block text-fg-muted">{record.comment}</span>{/if}
                {#if auth.isAdmin}
                  <span class="mt-1 flex gap-2">
                    <button
                      type="button"
                      class="btn px-2.5 py-1 text-xs"
                      onclick={() => void editRecord(record.zone, record.domain)}>Bearbeiten</button
                    >
                    <button
                      type="button"
                      class="btn px-2.5 py-1 text-xs"
                      onclick={() => deleteRecord(record.zone, record.domain)}>Löschen</button
                    >
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-fg-muted">Kein A-Eintrag auf diese Adresse.</p>
        {/if}
        {#if detail.dns.reverse}
          <p>
            <span class="font-medium">PTR</span> → {detail.dns.reverse.target}
            <span class="text-fg-muted">· Zone {detail.dns.reverse.zone}</span>
          </p>
        {:else if detail.dns.reverseZone}
          <p class="text-fg-muted">
            Kein PTR-Eintrag (Reverse-Zone {detail.dns.reverseZone} vorhanden).
          </p>
        {:else}
          <p class="text-fg-muted">Keine Reverse-Zone für diese Adresse.</p>
        {/if}
        {#if auth.isAdmin && zones.length > 0 && detail.state !== 'free'}
          <div class="flex flex-wrap items-center gap-2">
            <select class="field w-auto py-1 text-xs" bind:value={newRecordZone} aria-label="Zone">
              {#each zones as zone (zone)}<option value={zone}>{zone}</option>{/each}
            </select>
            <button type="button" class="btn px-2.5 py-1 text-xs" onclick={newRecord}
              >A-Eintrag anlegen</button
            >
          </div>
        {/if}
      </section>

      <section aria-labelledby="ip-reach" class="grid gap-1.5">
        <h3 id="ip-reach" class="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Erreichbarkeit
        </h3>
        <ReachDot alive={detail.alive} lastSeen={detail.lastSeen} />
        {#if detail.lastSeen}
          <p class="text-fg-muted">
            Zuletzt gesehen: {new Date(detail.lastSeen).toLocaleString('de-DE')}
          </p>
        {/if}
        {#if auth.isAdmin && detail.hostId !== null}
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn px-2.5 py-1 text-xs"
              class:btn-primary={detail.discovered}
              onclick={() => (hostOpen = true)}
              >{detail.discovered ? 'Bestätigen' : 'Name bearbeiten'}</button
            >
            <button type="button" class="btn px-2.5 py-1 text-xs" onclick={forgetHost}
              >Vergessen</button
            >
          </div>
        {/if}
      </section>
    {:else if loading}
      <p class="text-fg-muted">Lädt …</p>
    {/if}
  </div>
</aside>

{#if auth.isAdmin && detail}
  <ConfirmDialog
    open={confirm.open}
    title={confirm.title}
    message={confirm.message}
    confirmLabel={confirm.label}
    onclose={() => (confirm.open = false)}
    onconfirm={runConfirm}
  />
  <ConvertLeaseDialog
    open={convertOpen}
    {address}
    hostName={detail.dhcp.lease?.hostName ?? null}
    {zones}
    defaultZone={scopeDomain}
    hasDns={detail.dns.forward.length > 0}
    onclose={() => (convertOpen = false)}
    onsubmit={convertLease}
  />
  <ReservationForm
    open={reservationOpen}
    {scopes}
    existing={detail.dhcp.reservation
      ? {
          scope: detail.dhcp.reservation.scope,
          hardwareAddress: detail.dhcp.reservation.mac,
          address,
          hostName: detail.dhcp.reservation.hostName,
          comments: detail.dhcp.reservation.comment,
        }
      : null}
    onclose={() => (reservationOpen = false)}
    onsubmit={saveReservation}
  />
  <RecordForm
    open={recordForm.open}
    zone={recordForm.zone}
    record={recordForm.record}
    initial={recordForm.initial}
    onclose={() => (recordForm.open = false)}
    onsubmit={saveRecord}
  />
  <HostDialog
    open={hostOpen}
    {address}
    name={detail.hostName}
    confirmed={!detail.discovered}
    onclose={() => (hostOpen = false)}
    onsubmit={saveHost}
  />
{/if}

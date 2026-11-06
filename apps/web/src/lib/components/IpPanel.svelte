<script lang="ts">
  import type { IpamCategory, IpamIpDetail, IpamNetwork } from '@ultimate-dash/shared';
  import { api } from '$lib/api';
  import { categoryColor } from '$lib/ipam';
  import ReachDot from './ReachDot.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    address: string;
    network: IpamNetwork | null;
    categories: IpamCategory[];
    /** Wird bei jeder Änderung hochgezählt, damit das Fenster neu lädt. */
    version?: number;
    onclose: () => void;
  }
  let { address, network, categories, version = 0, onclose }: Props = $props();

  let detail = $state<IpamIpDetail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    const current = address;
    void version;
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
      </section>
    {:else if loading}
      <p class="text-fg-muted">Lädt …</p>
    {/if}
  </div>
</aside>

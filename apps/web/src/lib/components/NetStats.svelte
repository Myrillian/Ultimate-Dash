<script lang="ts" module>
  /** Filter für die Adressliste, z. B. `{ status: 'offline' }` */
  export type StatsFilter = Partial<Record<'type' | 'status' | 'flag', string>>;
</script>

<script lang="ts">
  import {
    IPAM_POOL_WARN,
    IPAM_RECENT_DAYS,
    IPAM_STALE_DAYS,
    type IpamNetworkStats,
  } from '@ultimate-dash/shared';
  import { formatCount, formatPercent } from '$lib/format';
  import SegmentedBar from './SegmentedBar.svelte';

  interface Props {
    stats: IpamNetworkStats;
    /** compact = Kacheln auf der Netz-Karte und in der Summenzeile, full = Netz im Detail */
    variant?: 'compact' | 'full';
    /** Nur bei `full`: Klick auf eine Kachel filtert die Adressliste. */
    onfilter?: (filter: StatsFilter) => void;
    /** Nur bei `compact`: alle vier Kacheln in einer Reihe (Summenzeile) statt 2 × 2 (Karte) */
    wide?: boolean;
  }

  let { stats: s, variant = 'compact', onfilter, wide = false }: Props = $props();

  const poolShare = $derived(s.pool && s.pool.size > 0 ? s.pool.used / s.pool.size : 0);
  const poolFull = $derived(!!s.pool && poolShare >= IPAM_POOL_WARN);

  interface Tile {
    key: string;
    label: string;
    value: string;
    sub?: string;
    tone?: 'down' | 'discovered' | 'muted';
    filter?: StatsFilter;
  }

  const notChecked = 'nicht geprüft';
  const compactTiles = $derived<Tile[]>([
    {
      key: 'used',
      label: 'Vergeben',
      value: formatCount(s.used),
      sub: `${formatPercent(s.used, s.total)} · ${formatCount(s.free)} frei`,
    },
    {
      key: 'online',
      label: 'Online',
      value: s.scanned ? formatCount(s.online) : '–',
      sub: s.scanned ? `${formatCount(s.noReply)} ohne Antwort` : notChecked,
      tone: s.scanned ? undefined : 'muted',
    },
    {
      key: 'discovered',
      label: 'Neu entdeckt',
      value: s.scanned ? formatCount(s.discovered) : '–',
      sub: s.scanned ? `${formatCount(s.recent)} neu seit ${IPAM_RECENT_DAYS} T.` : notChecked,
      tone: !s.scanned ? 'muted' : s.discovered > 0 ? 'discovered' : undefined,
    },
    {
      key: 'pool',
      label: 'DHCP-Pool',
      value: s.pool ? formatPercent(s.pool.used, s.pool.size) : '–',
      sub: s.pool
        ? poolFull
          ? `fast voll · ${formatCount(s.pool.free)} frei`
          : `${formatCount(s.pool.used)} von ${formatCount(s.pool.size)}`
        : 'kein Pool',
      tone: !s.pool ? 'muted' : poolFull ? 'down' : undefined,
    },
  ]);

  /** Hinweise, die nur erscheinen, wenn es etwas zu tun gibt */
  const notices = $derived(
    [
      { key: 'conflicts', n: s.conflicts, label: s.conflicts === 1 ? 'Konflikt' : 'Konflikte' },
      { key: 'stale', n: s.stale, label: `über ${IPAM_STALE_DAYS} T. nicht gesehen` },
      {
        key: 'expiring',
        n: s.expiring,
        label: s.expiring === 1 ? 'Lease läuft ab' : 'Leases laufen ab',
      },
      { key: 'noDns', n: s.noDns, label: 'ohne DNS' },
      { key: 'noPtr', n: s.noPtr, label: 'ohne PTR' },
    ].filter((x) => x.n > 0),
  );

  const fullTiles = $derived<Tile[]>([
    { key: 'total', label: 'Adressen gesamt', value: formatCount(s.total) },
    {
      key: 'used',
      label: 'Vergeben',
      value: formatCount(s.used),
      sub: formatPercent(s.used, s.total),
    },
    {
      key: 'free',
      label: 'Frei',
      value: formatCount(s.free),
      sub: s.pool ? `${formatCount(s.freeStatic)} außerhalb des Pools` : undefined,
    },
    {
      key: 'pool',
      label: 'DHCP-Pool belegt',
      value: s.pool ? formatPercent(s.pool.used, s.pool.size) : '–',
      sub: s.pool
        ? `${formatCount(s.pool.used)} von ${formatCount(s.pool.size)}${poolFull ? ' · fast voll' : ''}`
        : 'kein aktiver Pool',
      tone: !s.pool ? 'muted' : poolFull ? 'down' : undefined,
    },
    {
      key: 'reservation',
      label: 'Reservierungen',
      value: formatCount(s.byType.reservation),
      filter: { type: 'reservation' },
    },
    {
      key: 'lease',
      label: 'Leases',
      value: formatCount(s.byType.lease),
      sub: s.expiring > 0 ? `${formatCount(s.expiring)} laufen in 24 h ab` : undefined,
      filter: { type: 'lease' },
    },
    {
      key: 'static',
      label: 'Statisch',
      value: formatCount(s.byType.static),
      filter: { type: 'static' },
    },
    {
      key: 'online',
      label: 'Online',
      value: s.scanned ? formatCount(s.online) : '–',
      sub: s.scanned ? undefined : notChecked,
      tone: s.scanned ? undefined : 'muted',
      filter: s.scanned ? { status: 'online' } : undefined,
    },
    {
      key: 'noReply',
      label: 'Ohne Ping-Antwort',
      value: s.scanned ? formatCount(s.noReply) : '–',
      sub: s.scanned ? 'manche Geräte blocken Ping' : notChecked,
      tone: s.scanned ? undefined : 'muted',
      filter: s.scanned ? { status: 'offline' } : undefined,
    },
    {
      key: 'discovered',
      label: 'Neu entdeckt',
      value: s.scanned ? formatCount(s.discovered) : '–',
      sub: s.scanned ? 'noch nicht bestätigt' : notChecked,
      tone: !s.scanned ? 'muted' : s.discovered > 0 ? 'discovered' : undefined,
      filter: s.scanned ? { flag: 'discovered' } : undefined,
    },
    {
      key: 'recent',
      label: `Neu seit ${IPAM_RECENT_DAYS} Tagen`,
      value: s.scanned ? formatCount(s.recent) : '–',
      sub: s.scanned ? 'zum ersten Mal per Ping' : notChecked,
      tone: s.scanned ? undefined : 'muted',
      filter: s.scanned ? { flag: 'recent' } : undefined,
    },
    {
      key: 'stale',
      label: 'Lange nicht gesehen',
      value: s.scanned ? formatCount(s.stale) : '–',
      sub: s.scanned ? `über ${IPAM_STALE_DAYS} Tage` : notChecked,
      tone: s.scanned ? undefined : 'muted',
      filter: s.scanned ? { flag: 'stale' } : undefined,
    },
    {
      key: 'conflicts',
      label: 'Konflikte',
      value: formatCount(s.conflicts),
      tone: s.conflicts > 0 ? 'down' : undefined,
      filter: { flag: 'conflict' },
    },
    {
      key: 'noDns',
      label: 'Ohne DNS-Eintrag',
      value: formatCount(s.noDns),
      filter: { flag: 'no-dns' },
    },
    {
      key: 'noPtr',
      label: 'Ohne PTR',
      value: formatCount(s.noPtr),
      sub: 'A-Eintrag da, PTR fehlt',
      filter: { flag: 'no-ptr' },
    },
  ]);

  const parts = $derived([
    {
      key: 'reservation',
      label: 'Reservierung',
      color: 'var(--chart-recursive)',
      value: s.byType.reservation,
      ink: 'light' as const,
    },
    {
      key: 'lease',
      label: 'Lease',
      color: 'var(--chart-queries)',
      value: s.byType.lease,
      ink: 'light' as const,
    },
    {
      key: 'static',
      label: 'Statisch',
      color: 'var(--chart-cached)',
      value: s.byType.static,
      ink: 'dark' as const,
    },
    {
      key: 'discovered',
      label: 'Entdeckt',
      color: 'var(--chart-blocked)',
      value: s.byType.discovered,
      ink: 'dark' as const,
    },
    {
      key: 'pool',
      label: 'Frei im DHCP-Pool',
      color: 'var(--chart-dropped)',
      value: s.pool?.free ?? 0,
      ink: 'dark' as const,
    },
    {
      key: 'free',
      label: 'Frei',
      color: 'var(--bg-muted)',
      value: s.freeStatic,
      ink: 'dark' as const,
    },
  ]);

  const toneClass = (tone: Tile['tone']) =>
    tone === 'down' ? 'text-down' : tone === 'muted' ? 'text-fg-muted' : '';
</script>

{#snippet tileBody(t: Tile, small: boolean)}
  <span class="block truncate text-[11px] text-fg-muted">{t.label}</span>
  <span
    class="block font-semibold tabular-nums {small ? 'text-base' : 'text-lg'} {toneClass(t.tone)}"
    style={t.tone === 'discovered' ? 'color: var(--discovered)' : undefined}>{t.value}</span
  >
  {#if t.sub}
    <span class="block truncate text-[11px] {t.tone === 'down' ? 'text-down' : 'text-fg-muted'}"
      >{t.sub}</span
    >
  {/if}
{/snippet}

{#if variant === 'compact'}
  <div class="grid gap-2">
    <dl class="grid grid-cols-2 gap-1.5 {wide ? 'sm:grid-cols-4' : ''}">
      {#each compactTiles as t (t.key)}
        <div class="min-w-0 rounded-lg bg-muted/60 px-2 py-1.5">
          <dt class="sr-only">{t.label}</dt>
          <dd>{@render tileBody(t, true)}</dd>
        </div>
      {/each}
    </dl>
    {#if notices.length > 0}
      <ul class="flex flex-wrap gap-1.5 text-[11px]">
        {#each notices as n (n.key)}
          <li
            class="rounded-full px-2 py-0.5 font-medium {n.key === 'conflicts'
              ? 'bg-down/15 text-down'
              : 'bg-muted text-fg'}"
          >
            <span class="tabular-nums">{formatCount(n.n)}</span>
            {n.label}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <div class="grid gap-4">
    <SegmentedBar {parts} label="Adressen nach Art der Vergabe" />
    <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {#each fullTiles as t (t.key)}
        <li class="min-w-0">
          {#if t.filter && onfilter}
            <button
              type="button"
              class="h-full w-full rounded-lg border border-line px-3 py-2 text-left transition hover:border-accent focus-visible:border-accent"
              title="In der Liste zeigen"
              onclick={() => onfilter(t.filter!)}
            >
              {@render tileBody(t, false)}
            </button>
          {:else}
            <div class="h-full rounded-lg border border-transparent bg-muted/60 px-3 py-2">
              {@render tileBody(t, false)}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

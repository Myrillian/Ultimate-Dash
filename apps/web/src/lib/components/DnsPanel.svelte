<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { DnsTopEntry, StatsRange } from '@ultimate-dash/shared';
  import { auth } from '$lib/auth.svelte';
  import { dns } from '$lib/dns.svelte';
  import { formatCount, formatPercent, formatRemaining } from '$lib/format';
  import { toasts } from '$lib/toasts.svelte';
  import SegmentedBar from './SegmentedBar.svelte';
  import TimeSeriesChart, { type ChartSeries } from './TimeSeriesChart.svelte';
  import UiIcon from './UiIcon.svelte';

  let { onconnect }: { onconnect: () => void } = $props();

  const RANGES: { value: StatsRange; label: string; long: string }[] = [
    { value: 'hour', label: '1 Std.', long: 'letzte Stunde' },
    { value: 'day', label: '24 Std.', long: 'letzte 24 Stunden' },
    { value: 'week', label: '7 Tage', long: 'letzte 7 Tage' },
    { value: 'month', label: '30 Tage', long: 'letzte 30 Tage' },
    { value: 'year', label: '1 Jahr', long: 'letztes Jahr' },
  ];

  let tableView = $state(false);
  let topTab = $state<'domains' | 'blocked' | 'clients'>('domains');
  let busy = $state<string | null>(null);
  let now = $state(Date.now());
  let pauseMenu = $state(false);
  let pauseRoot: HTMLDivElement | undefined = $state();

  const ticker = setInterval(() => (now = Date.now()), 1000);
  onMount(() => dns.start());
  onDestroy(() => {
    clearInterval(ticker);
    dns.stop();
  });

  const summary = $derived(dns.summary);
  const t = $derived(summary?.totals);
  const blocking = $derived(summary?.blocking);
  const pausedMs = $derived(
    blocking?.pausedUntil ? Math.max(0, Date.parse(blocking.pausedUntil) - now) : 0,
  );
  // Abgelaufene Pause: Technitium schaltet selbst wieder ein, neu laden zeigt es an.
  $effect(() => {
    if (blocking?.pausedUntil && pausedMs === 0) void dns.load();
  });

  const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('de-DE', options);
  const xFormats: Record<StatsRange, Intl.DateTimeFormat> = {
    hour: fmt({ hour: '2-digit', minute: '2-digit' }),
    day: fmt({ hour: '2-digit', minute: '2-digit' }),
    week: fmt({ weekday: 'short', day: '2-digit', month: '2-digit' }),
    month: fmt({ day: '2-digit', month: '2-digit' }),
    year: fmt({ month: 'short', year: '2-digit' }),
  };
  const longFormats: Record<StatsRange, Intl.DateTimeFormat> = {
    hour: fmt({ hour: '2-digit', minute: '2-digit' }),
    day: fmt({ weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    week: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
    month: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
    year: fmt({ month: 'long', year: 'numeric' }),
  };
  const tableFormat = fmt({ dateStyle: 'short', timeStyle: 'short' });

  const series = $derived<ChartSeries[]>(
    summary
      ? [
          {
            key: 'queries',
            label: 'Anfragen',
            color: 'var(--chart-queries)',
            values: summary.series.queries,
            area: true,
          },
          {
            key: 'blocked',
            label: 'Geblockt',
            color: 'var(--chart-blocked)',
            values: summary.series.blocked,
          },
        ]
      : [],
  );

  const answerParts = $derived(
    t
      ? [
          {
            key: 'cached',
            label: 'Cache',
            color: 'var(--chart-cached)',
            value: t.cached,
            ink: 'dark' as const,
          },
          {
            key: 'authoritative',
            label: 'Eigene Zonen',
            color: 'var(--chart-authoritative)',
            value: t.authoritative,
            ink: 'dark' as const,
          },
          {
            key: 'recursive',
            label: 'Rekursiv aufgelöst',
            color: 'var(--chart-recursive)',
            value: t.recursive,
            ink: 'light' as const,
          },
          {
            key: 'blocked',
            label: 'Geblockt',
            color: 'var(--chart-blocked)',
            value: t.blocked,
            ink: 'dark' as const,
          },
          {
            key: 'dropped',
            label: 'Verworfen',
            color: 'var(--chart-dropped)',
            value: t.dropped,
            ink: 'dark' as const,
          },
        ]
      : [],
  );

  const topLists = $derived<
    Record<typeof topTab, { entries: DnsTopEntry[]; color: string; empty: string }>
  >({
    domains: {
      entries: summary?.topDomains ?? [],
      color: 'var(--chart-queries)',
      empty: 'Noch keine Anfragen in diesem Zeitraum.',
    },
    blocked: {
      entries: summary?.topBlocked ?? [],
      color: 'var(--chart-blocked)',
      empty: 'In diesem Zeitraum wurde nichts geblockt.',
    },
    clients: {
      entries: summary?.topClients ?? [],
      color: 'var(--chart-queries)',
      empty: 'Noch keine Clients in diesem Zeitraum.',
    },
  });
  const currentTop = $derived(topLists[topTab]);
  const topMax = $derived(Math.max(1, ...currentTop.entries.map((e) => e.hits)));

  async function act(key: string, action: Parameters<typeof dns.blocking>[0], success: string) {
    busy = key;
    pauseMenu = false;
    try {
      await dns.blocking(action);
      toasts.show(success);
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : 'Aktion fehlgeschlagen', 'error');
    } finally {
      busy = null;
    }
  }

  const rangeLong = $derived(RANGES.find((r) => r.value === dns.range)!.long);
</script>

<svelte:window
  onclick={(event) => {
    if (pauseMenu && pauseRoot && !pauseRoot.contains(event.target as Node)) pauseMenu = false;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && pauseMenu) pauseMenu = false;
  }}
/>

{#if dns.status === 'not-configured'}
  {#if auth.isAdmin}
    <section
      class="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line p-5"
      aria-label="DNS"
    >
      <span class="grid size-10 place-items-center rounded-xl bg-muted text-fg-muted">
        <UiIcon name="server" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="font-medium">Technitium DNS verbinden</p>
        <p class="text-sm text-fg-muted">
          Zeigt Anfragen, Blocking und Top-Listen direkt hier auf dem Dashboard.
        </p>
      </div>
      <button type="button" class="btn btn-primary" onclick={onconnect}>Verbinden</button>
    </section>
  {/if}
{:else if dns.status !== 'idle'}
  <section class="grid gap-4" aria-labelledby="dns-title">
    <!-- Kopfzeile: Titel, Zeitraum (gilt für alles darunter), Blocking -->
    <div class="flex flex-wrap items-center gap-3">
      <h2 id="dns-title" class="flex items-center gap-2 text-sm font-semibold">
        <UiIcon name="shield" size={16} class="text-fg-muted" />
        DNS
        {#if summary}<span class="font-normal text-fg-muted">· {summary.serverDomain}</span>{/if}
      </h2>

      <div
        class="inline-flex rounded-lg border border-line bg-elevated p-0.5"
        role="radiogroup"
        aria-label="Zeitraum"
      >
        {#each RANGES as range (range.value)}
          <button
            type="button"
            role="radio"
            aria-checked={dns.range === range.value}
            class="rounded-md px-2.5 py-1 text-xs font-medium transition"
            class:bg-muted={dns.range === range.value}
            class:text-fg={dns.range === range.value}
            class:text-fg-muted={dns.range !== range.value}
            onclick={() => dns.setRange(range.value)}>{range.label}</button
          >
        {/each}
      </div>

      {#if blocking}
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            class:bg-up={blocking.enabled}
            class:text-white={blocking.enabled}
            class:bg-muted={!blocking.enabled}
            role="status"
          >
            <UiIcon name={blocking.enabled ? 'shield' : 'shield-off'} size={14} />
            {#if blocking.enabled}
              Blocking aktiv
            {:else if blocking.pausedUntil}
              Pausiert, noch {formatRemaining(pausedMs)}
            {:else}
              Blocking aus
            {/if}
          </span>

          {#if auth.isAdmin}
            {#if blocking.enabled}
              <div class="relative" bind:this={pauseRoot}>
                <button
                  type="button"
                  class="btn py-1.5"
                  aria-haspopup="true"
                  aria-expanded={pauseMenu}
                  disabled={busy !== null}
                  onclick={() => (pauseMenu = !pauseMenu)}
                >
                  <UiIcon name="pause" size={14} /> Pausieren
                </button>
                {#if pauseMenu}
                  <div
                    class="absolute top-full right-0 z-20 mt-1 grid w-44 rounded-xl border border-line bg-elevated p-1 shadow-xl"
                  >
                    {#each [5, 15, 60] as minutes (minutes)}
                      <button
                        type="button"
                        class="rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                        onclick={() =>
                          act(
                            'pause',
                            { action: 'pause', minutes },
                            `Blocking für ${minutes} Min. pausiert`,
                          )}>{minutes === 60 ? '1 Stunde' : `${minutes} Minuten`}</button
                      >
                    {/each}
                    <button
                      type="button"
                      class="mt-1 rounded-lg border-t border-line px-2.5 py-1.5 text-left text-sm text-down hover:bg-muted"
                      onclick={() =>
                        act('disable', { action: 'disable' }, 'Blocking ausgeschaltet')}
                      >Dauerhaft ausschalten</button
                    >
                  </div>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                class="btn btn-primary py-1.5"
                disabled={busy !== null}
                onclick={() => act('enable', { action: 'enable' }, 'Blocking eingeschaltet')}
              >
                <UiIcon name="play" size={14} />
                {blocking.pausedUntil ? 'Jetzt fortsetzen' : 'Einschalten'}
              </button>
            {/if}
            <button
              type="button"
              class="icon-btn"
              aria-label="Blocklisten jetzt aktualisieren"
              title="Blocklisten jetzt aktualisieren"
              disabled={busy !== null}
              onclick={() =>
                act('lists', { action: 'update-lists' }, 'Blocklisten werden aktualisiert')}
            >
              <UiIcon name="refresh" size={16} class={busy === 'lists' ? 'animate-spin' : ''} />
            </button>
          {/if}
        </div>
      {/if}
    </div>

    {#if dns.status === 'error' && !summary}
      <div class="rounded-2xl border border-down/40 bg-elevated p-5 text-sm" role="alert">
        <p class="font-medium">DNS-Statistik nicht verfügbar</p>
        <p class="mt-1 text-fg-muted">{dns.error}</p>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn" onclick={() => dns.load()}>Erneut versuchen</button>
          {#if auth.isAdmin}
            <button type="button" class="btn" onclick={onconnect}>Verbindung prüfen</button>
          {/if}
        </div>
      </div>
    {:else if !summary || !t}
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Lädt">
        {#each Array(4) as _, i (i)}<div
            class="h-20 animate-pulse rounded-2xl bg-muted"
          ></div>{/each}
      </div>
    {:else}
      {#if dns.status === 'error'}
        <p class="text-xs text-down" role="status">
          Aktualisierung fehlgeschlagen: {dns.error}. Angezeigt wird der letzte Stand.
        </p>
      {/if}

      <!-- Kennzahlen -->
      <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {#each [{ label: 'Anfragen', value: formatCount(t.queries), sub: rangeLong }, { label: 'Geblockt', value: formatCount(t.blocked), sub: `${formatPercent(t.blocked, t.queries)} aller Anfragen` }, { label: 'Aus dem Cache', value: formatPercent(t.cached, t.queries), sub: `${formatCount(t.cached)} Antworten` }, { label: 'Clients', value: formatCount(t.clients), sub: `${formatCount(blocking!.blockedDomains)} Domains auf Sperrlisten` }] as tile (tile.label)}
          <div class="rounded-2xl border border-line bg-elevated p-4">
            <dt class="text-xs text-fg-muted">{tile.label}</dt>
            <dd class="mt-1 text-2xl font-semibold tracking-tight">{tile.value}</dd>
            <dd class="mt-0.5 truncate text-xs text-fg-muted">{tile.sub}</dd>
          </div>
        {/each}
      </dl>

      <div
        class="grid gap-4 transition-opacity lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        class:opacity-60={dns.status === 'loading'}
      >
        <div class="grid gap-3 rounded-2xl border border-line bg-elevated p-4">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h3 class="text-sm font-semibold">Anfragen im Verlauf</h3>
            <ul class="flex gap-3 text-xs text-fg-muted" aria-label="Legende">
              {#each series as s (s.key)}
                <li class="flex items-center gap-1.5">
                  <span class="h-0.5 w-3 rounded-full" style="background: {s.color}"
                  ></span>{s.label}
                </li>
              {/each}
            </ul>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
              aria-pressed={tableView}
              onclick={() => (tableView = !tableView)}
            >
              <UiIcon name={tableView ? 'chart' : 'table'} size={14} />
              {tableView ? 'Als Diagramm' : 'Als Tabelle'}
            </button>
          </div>

          {#if tableView}
            <div class="max-h-56 overflow-y-auto rounded-lg border border-line">
              <table class="w-full text-left text-xs tabular-nums">
                <caption class="sr-only">Anfragen und geblockte Anfragen, {rangeLong}</caption>
                <thead class="sticky top-0 bg-muted text-fg-muted">
                  <tr>
                    <th class="px-3 py-1.5 font-medium">Zeitpunkt</th>
                    <th class="px-3 py-1.5 text-right font-medium">Anfragen</th>
                    <th class="px-3 py-1.5 text-right font-medium">Geblockt</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {#each summary.series.labels as label, i (label)}
                    <tr>
                      <td class="px-3 py-1">{tableFormat.format(new Date(label))}</td>
                      <td class="px-3 py-1 text-right"
                        >{formatCount(summary.series.queries[i] ?? 0)}</td
                      >
                      <td class="px-3 py-1 text-right"
                        >{formatCount(summary.series.blocked[i] ?? 0)}</td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <TimeSeriesChart
              labels={summary.series.labels}
              {series}
              formatX={(d) => xFormats[dns.range].format(d)}
              formatXLong={(d) => longFormats[dns.range].format(d)}
              label="Anfragen und geblockte Anfragen, {rangeLong}"
            />
          {/if}

          <div class="border-t border-line pt-3">
            <h3 class="mb-2 text-sm font-semibold">Woher die Antworten kamen</h3>
            <SegmentedBar parts={answerParts} label="Antworten nach Herkunft" />
          </div>
        </div>

        <div class="grid content-start gap-3 rounded-2xl border border-line bg-elevated p-4">
          <div class="flex gap-1 rounded-lg bg-muted p-0.5" role="tablist" aria-label="Top-Listen">
            {#each [{ value: 'domains', label: 'Domains' }, { value: 'blocked', label: 'Geblockt' }, { value: 'clients', label: 'Clients' }] as const as tab (tab.value)}
              <button
                type="button"
                role="tab"
                id="dns-tab-{tab.value}"
                aria-selected={topTab === tab.value}
                aria-controls="dns-top-panel"
                class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition"
                class:bg-elevated={topTab === tab.value}
                class:shadow-sm={topTab === tab.value}
                class:text-fg-muted={topTab !== tab.value}
                onclick={() => (topTab = tab.value)}>{tab.label}</button
              >
            {/each}
          </div>
          <div id="dns-top-panel" role="tabpanel" aria-labelledby="dns-tab-{topTab}">
            {#if currentTop.entries.length === 0}
              <p class="py-6 text-center text-sm text-fg-muted">{currentTop.empty}</p>
            {:else}
              <ol class="grid gap-2.5">
                {#each currentTop.entries as entry (entry.name)}
                  <li class="grid gap-1">
                    <div class="flex items-baseline gap-2 text-sm">
                      <span class="min-w-0 flex-1 truncate" title={entry.name}>
                        {entry.domain ?? entry.name}
                        {#if entry.domain}<span class="text-xs text-fg-muted">{entry.name}</span
                          >{/if}
                      </span>
                      <span class="text-xs text-fg-muted tabular-nums"
                        >{formatCount(entry.hits)}</span
                      >
                    </div>
                    <div class="h-1.5 rounded-full bg-muted" aria-hidden="true">
                      <div
                        class="h-full rounded-full"
                        style="width: {(entry.hits / topMax) *
                          100}%; background: {currentTop.color}"
                      ></div>
                    </div>
                  </li>
                {/each}
              </ol>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </section>
{/if}

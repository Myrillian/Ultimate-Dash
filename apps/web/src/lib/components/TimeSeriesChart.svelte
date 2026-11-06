<script lang="ts" module>
  export interface ChartSeries {
    key: string;
    label: string;
    /** CSS-Farbe, z. B. `var(--chart-queries)` */
    color: string;
    values: number[];
    /** Fläche unter der Linie (leichte Tönung) */
    area?: boolean;
  }
</script>

<script lang="ts">
  import { formatCount, formatTick, niceTicks } from '$lib/format';

  interface Props {
    /** Zeitpunkte als ISO-Strings */
    labels: string[];
    series: ChartSeries[];
    formatX: (date: Date) => string;
    /** Ausführlicher Zeitpunkt für den Tooltip */
    formatXLong: (date: Date) => string;
    label: string;
  }

  let { labels, series, formatX, formatXLong, label }: Props = $props();

  const HEIGHT = 180;
  const PAD = { top: 12, bottom: 26, left: 44 };

  let width = $state(600);
  let active = $state<number | null>(null);
  // Schmale Ansicht: kein Platz für Endbeschriftungen, Legende und Tooltip genügen.
  const narrow = $derived(width < 480);
  const padRight = $derived(narrow ? 12 : 76);

  const dates = $derived(labels.map((l) => new Date(l)));
  const count = $derived(labels.length);
  const max = $derived(Math.max(1, ...series.flatMap((s) => s.values)));
  const ticks = $derived(niceTicks(max));
  const top = $derived(ticks.at(-1)!);
  const plotW = $derived(Math.max(10, width - PAD.left - padRight));
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  function linePath(values: number[]): string {
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  }
  function areaPath(values: number[]): string {
    if (values.length === 0) return '';
    const base = y(0).toFixed(1);
    return `${linePath(values)}L${x(values.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;
  }

  /** Höchstens ~6 Beschriftungen, gleichmäßig verteilt, letzte immer dabei. */
  const xTicks = $derived.by(() => {
    if (count === 0) return [];
    const wanted = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
    const step = Math.max(1, Math.round((count - 1) / (wanted - 1)));
    const result: number[] = [];
    for (let i = 0; i < count; i += step) result.push(i);
    if (result.at(-1) !== count - 1) {
      if (count - 1 - result.at(-1)! < step / 2) result.pop();
      result.push(count - 1);
    }
    return result;
  });

  /** Endbeschriftungen nur, wenn sie sich nicht überlappen; sonst tragen Legende und Tooltip. */
  const endLabels = $derived.by(() => {
    if (count === 0 || narrow) return [];
    const items = series.map((s) => ({ ...s, y: y(s.values.at(-1) ?? 0) }));
    const sorted = [...items].sort((a, b) => a.y - b.y);
    const collide = sorted.some((item, i) => i > 0 && item.y - sorted[i - 1]!.y < 15);
    return collide ? [] : items;
  });

  function pick(clientX: number, target: Element) {
    const rect = target.getBoundingClientRect();
    const relative = ((clientX - rect.left) / rect.width) * width - PAD.left;
    active = Math.max(0, Math.min(count - 1, Math.round((relative / plotW) * (count - 1))));
  }

  function onKeydown(event: KeyboardEvent) {
    if (count === 0) return;
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in moves) {
      event.preventDefault();
      active = Math.max(0, Math.min(count - 1, (active ?? count) + moves[event.key]!));
    } else if (event.key === 'Home') active = 0;
    else if (event.key === 'End') active = count - 1;
    else if (event.key === 'Escape') active = null;
  }

  const tooltipLeft = $derived(active === null ? 0 : x(active));
</script>

<div class="relative w-full min-w-0" bind:clientWidth={width}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    {width}
    height={HEIGHT}
    viewBox="0 0 {width} {HEIGHT}"
    role="img"
    aria-label="{label}. Mit den Pfeiltasten durch die Zeitpunkte gehen."
    tabindex="0"
    class="block w-full touch-pan-y overflow-visible outline-offset-4"
    onkeydown={onKeydown}
    onblur={() => (active = null)}
  >
    <!-- Raster und y-Achse -->
    {#each ticks as tick (tick)}
      <line
        x1={PAD.left}
        x2={PAD.left + plotW}
        y1={y(tick)}
        y2={y(tick)}
        stroke="var(--chart-grid)"
        stroke-width="1"
        shape-rendering="crispEdges"
      />
      <text
        x={PAD.left - 8}
        y={y(tick)}
        dy="0.32em"
        text-anchor="end"
        class="fill-fg-muted text-[11px] tabular-nums">{formatTick(tick, top)}</text
      >
    {/each}

    <!-- x-Achse -->
    {#each xTicks as i (i)}
      <text
        x={x(i)}
        y={HEIGHT - 6}
        text-anchor={i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}
        class="fill-fg-muted text-[11px] tabular-nums">{formatX(dates[i]!)}</text
      >
    {/each}

    {#each series as s (s.key)}
      {#if s.area}
        <path d={areaPath(s.values)} fill={s.color} opacity="0.1" />
      {/if}
      <path
        d={linePath(s.values)}
        fill="none"
        stroke={s.color}
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    {/each}

    <!-- Endpunkte mit Wert -->
    {#if active === null}
      {#each series as s (s.key)}
        {#if s.values.length > 0}
          <circle
            cx={x(s.values.length - 1)}
            cy={y(s.values.at(-1)!)}
            r="4"
            fill={s.color}
            stroke="var(--bg-elevated)"
            stroke-width="2"
          />
        {/if}
      {/each}
      {#each endLabels as item (item.key)}
        <text x={PAD.left + plotW + 10} y={item.y} dy="0.32em" class="text-[11px]">
          <tspan class="fill-fg font-medium tabular-nums">{formatCount(item.values.at(-1)!)}</tspan>
          <tspan class="fill-fg-muted"> {item.label}</tspan>
        </text>
      {/each}
    {/if}

    <!-- Fadenkreuz -->
    {#if active !== null}
      <line
        x1={x(active)}
        x2={x(active)}
        y1={PAD.top}
        y2={PAD.top + plotH}
        stroke="var(--text-muted)"
        stroke-width="1"
        shape-rendering="crispEdges"
      />
      {#each series as s (s.key)}
        <circle
          cx={x(active)}
          cy={y(s.values[active] ?? 0)}
          r="4"
          fill={s.color}
          stroke="var(--bg-elevated)"
          stroke-width="2"
        />
      {/each}
    {/if}

    <!-- Trefferfläche über die ganze Zeichenfläche: der Zeiger muss nur die Zeit treffen -->
    <rect
      x={PAD.left}
      y={0}
      width={plotW}
      height={HEIGHT}
      fill="transparent"
      role="presentation"
      onpointermove={(event) => pick(event.clientX, event.currentTarget.ownerSVGElement!)}
      onpointerdown={(event) => pick(event.clientX, event.currentTarget.ownerSVGElement!)}
      onpointerleave={() => (active = null)}
    />
  </svg>

  {#if active !== null}
    <div
      class="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-elevated px-3 py-2 text-xs shadow-lg"
      style="left: {tooltipLeft}px; transform: translateX({tooltipLeft > width / 2
        ? 'calc(-100% - 12px)'
        : '12px'})"
      aria-live="polite"
    >
      <p class="mb-1 text-fg-muted">{formatXLong(dates[active]!)}</p>
      {#each series as s (s.key)}
        <p class="flex items-center gap-2">
          <span class="h-0.5 w-3 rounded-full" style="background: {s.color}"></span>
          <span class="font-semibold tabular-nums">{formatCount(s.values[active] ?? 0)}</span>
          <span class="text-fg-muted">{s.label}</span>
        </p>
      {/each}
    </div>
  {/if}
</div>

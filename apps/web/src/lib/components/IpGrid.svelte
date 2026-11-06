<script lang="ts">
  import ReachDot from './ReachDot.svelte';
  import { categoryColor, cellKindLabel, type Cell, type CellKind } from '$lib/ipam';

  let {
    cells,
    label,
    onpick,
    selected = null,
  }: {
    cells: Cell[];
    label: string;
    onpick?: (cell: Cell) => void;
    selected?: string | null;
  } = $props();

  let active = $state<number | null>(null);
  const columns = $derived(cells.length > 256 ? 32 : 16);
  const current = $derived(active === null ? null : (cells[active] ?? null));

  /** Neu entdeckte Geräte tragen einen Ring in der Hervorhebungsfarbe, Offline-Adressen sind abgeblendet. */
  function style(cell: Cell): string {
    const base = baseStyle(cell);
    const extra: string[] = [];
    if (cell.usage?.discovered)
      extra.push('box-shadow:inset 0 0 0 2px var(--bg-elevated),0 0 0 2px var(--discovered)');
    if (cell.usage?.alive === false && !cell.usage.discovered) extra.push('opacity:0.5');
    return [base, ...extra].filter(Boolean).join(';');
  }

  function baseStyle(cell: Cell): string {
    const color = cell.category ? categoryColor(cell.category.color) : null;
    switch (cell.kind) {
      case 'static':
        return `background:${color ?? 'var(--text-muted)'}`;
      case 'used':
        return `background:${color ?? 'var(--text-muted)'}`;
      case 'reserved':
        // Innenring unterscheidet Reservierungen von dynamisch belegten Adressen, nicht nur die Farbe.
        return `background:${color ?? 'var(--text-muted)'};box-shadow:inset 0 0 0 2px var(--bg-elevated)`;
      case 'conflict':
        return 'background:var(--down)';
      case 'pool':
        return `background:repeating-linear-gradient(45deg,color-mix(in srgb,${color ?? 'var(--text-muted)'} 45%,transparent) 0 2px,transparent 2px 5px);border-color:color-mix(in srgb,${color ?? 'var(--border)'} 60%,var(--border))`;
      case 'free':
        return color
          ? `background:color-mix(in srgb,${color} 14%,transparent);border-color:color-mix(in srgb,${color} 55%,var(--border))`
          : '';
      default:
        return 'background:var(--bg-muted)';
    }
  }

  const claimLabel = {
    dns: 'DNS',
    reservation: 'Reservierung',
    lease: 'Lease',
    discovered: 'Per Ping entdeckt',
    manual: 'Von Hand bestätigt',
  } as const;
  const legend: CellKind[] = ['used', 'reserved', 'static', 'conflict', 'pool', 'free', 'gateway'];
  const sample = (kind: CellKind): Cell => ({
    address: '',
    kind,
    category: null,
    range: null,
    usage: null,
  });

  const glyph: Partial<Record<CellKind, string>> = { conflict: '!', gateway: 'G', static: 'S' };

  function onKeydown(event: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (event.key in moves) {
      event.preventDefault();
      active =
        active === null ? 0 : Math.max(0, Math.min(cells.length - 1, active + moves[event.key]!));
    } else if (event.key === 'Home') active = 0;
    else if (event.key === 'End') active = cells.length - 1;
    else if (event.key === 'Escape') active = null;
    else if ((event.key === 'Enter' || event.key === ' ') && current && onpick) {
      event.preventDefault();
      onpick(current);
    }
  }
</script>

<div class="grid min-w-0 gap-3">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    tabindex="0"
    aria-label="{label}. Mit den Pfeiltasten durch die Adressen gehen, Details stehen darunter."
    class="grid gap-[3px] outline-offset-4"
    style="grid-template-columns: repeat({columns}, minmax(0, 1fr))"
    onkeydown={onKeydown}
    onblur={() => (active = null)}
  >
    {#each cells as cell, i (cell.address)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        aria-hidden="true"
        class="grid aspect-square min-w-0 place-items-center rounded-[3px] border border-line text-[10px] leading-none font-bold text-white transition-[outline]"
        class:outline-2={active === i || selected === cell.address}
        class:outline-fg={active === i || selected === cell.address}
        class:z-10={active === i}
        class:cursor-pointer={!!onpick}
        class:text-fg-muted={cell.kind === 'gateway'}
        style={style(cell)}
        onpointerenter={() => (active = i)}
        onpointerleave={() => (active = null)}
        onclick={() => onpick?.(cell)}
      >
        {glyph[cell.kind] ?? ''}
      </div>
    {/each}
  </div>

  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-hidden="true">
    {#each legend as kind (kind)}
      <li class="flex items-center gap-1.5">
        <span class="size-3 rounded-[3px] border border-line" style={style(sample(kind))}></span>
        {cellKindLabel[kind]}
      </li>
    {/each}
    <li class="flex items-center gap-1.5">
      <span
        class="size-3 rounded-[3px] bg-text-muted"
        style="background:var(--text-muted);box-shadow:inset 0 0 0 2px var(--bg-elevated),0 0 0 2px var(--discovered)"
      ></span>
      Entdeckt
    </li>
    <li class="flex items-center gap-1.5">
      <span class="size-3 rounded-[3px] opacity-50" style="background:var(--text-muted)"></span>
      Antwortet nicht
    </li>
  </ul>

  <div class="min-h-10 text-sm" aria-live="polite">
    {#if current}
      <p class="flex flex-wrap items-baseline gap-x-2">
        <span class="font-mono font-semibold">{current.address}</span>
        <span class="text-fg-muted">
          {cellKindLabel[current.kind]}{current.category ? ` · ${current.category.name}` : ''}
        </span>
        {#if current.usage}
          <ReachDot alive={current.usage.alive} lastSeen={current.usage.lastSeen} />
          {#if current.usage.discovered}
            <span class="text-xs font-semibold" style="color: var(--discovered)">Neu entdeckt</span>
          {/if}
        {/if}
      </p>
      {#if current.usage}
        <ul class="mt-0.5 text-xs text-fg-muted">
          {#each current.usage.claims as claim, i (i)}
            <li>
              {claim.source === 'dns'
                ? 'DNS'
                : claim.source === 'reservation'
                  ? 'Reservierung'
                  : 'Lease'}
              {#if claim.name}· {claim.name}{/if}
              {#if claim.mac}· <span class="font-mono">{claim.mac}</span>{/if}
              {#if claim.scope}· {claim.scope}{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="text-xs text-fg-muted">
        Adresse anzeigen: Zeiger darüber bewegen oder Pfeiltasten.
      </p>
    {/if}
  </div>
</div>

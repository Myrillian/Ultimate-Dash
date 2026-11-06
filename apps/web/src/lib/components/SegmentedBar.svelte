<script lang="ts">
  import { formatCount, formatPercent } from '$lib/format';

  interface Part {
    key: string;
    label: string;
    color: string;
    value: number;
    /** Text im Block: hell oder dunkel, je nach Helligkeit der Farbe */
    ink: 'light' | 'dark';
  }

  let { parts, label }: { parts: Part[]; label: string } = $props();

  let width = $state(400);
  let active = $state<string | null>(null);

  const total = $derived(parts.reduce((sum, part) => sum + part.value, 0));
  const visible = $derived(parts.filter((part) => part.value > 0));
  const GAP = 2;

  /** Breite in Pixeln je Block, abzüglich der Lücken */
  const widths = $derived.by(() => {
    const available = Math.max(0, width - GAP * Math.max(0, visible.length - 1));
    return visible.map((part) => (total > 0 ? (part.value / total) * available : 0));
  });

  const describe = (part: Part) =>
    `${part.label}: ${formatCount(part.value)} (${formatPercent(part.value, total)})`;
  const activePart = $derived(parts.find((part) => part.key === active));
</script>

<div class="grid min-w-0 gap-2">
  <div
    class="relative flex h-7 w-full min-w-0"
    style="gap: {GAP}px"
    bind:clientWidth={width}
    role="list"
    aria-label={label}
  >
    {#each visible as part, i (part.key)}
      {@const share = formatPercent(part.value, total)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        role="listitem"
        tabindex="0"
        aria-label={describe(part)}
        class="flex h-full min-w-0 items-center rounded px-2 text-[11px] font-semibold transition-[filter] outline-offset-2"
        class:brightness-110={active === part.key}
        style="flex: {part.value} 1 0; background: {part.color}; color: {part.ink === 'light'
          ? '#ffffff'
          : '#14161c'}"
        onpointerenter={() => (active = part.key)}
        onpointerleave={() => (active = null)}
        onfocus={() => (active = part.key)}
        onblur={() => (active = null)}
      >
        <!-- Anteil nur, wenn er mit Abstand in den Block passt -->
        {#if widths[i]! >= share.length * 7 + 16}<span aria-hidden="true">{share}</span>{/if}
      </div>
    {/each}
    {#if total === 0}
      <div class="h-full w-full rounded bg-muted"></div>
    {/if}
  </div>

  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-hidden="true">
    {#each parts as part (part.key)}
      <li class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" style="background: {part.color}"></span>
        {part.label}
      </li>
    {/each}
  </ul>
  <p class="min-h-4 text-xs" aria-live="polite">
    {#if activePart}
      <span class="font-semibold tabular-nums">{formatCount(activePart.value)}</span>
      <span class="text-fg-muted"
        >{activePart.label} · {formatPercent(activePart.value, total)}</span
      >
    {/if}
  </p>
</div>

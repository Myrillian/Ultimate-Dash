<script lang="ts">
  /** Kleiner Verlauf ohne Achsen, nur als Andeutung neben einer Kennzahl. */
  let {
    values,
    color = 'var(--chart-queries)',
    max,
  }: { values: number[]; color?: string; max?: number } = $props();

  const points = $derived.by(() => {
    if (values.length < 2) return '';
    const top = Math.max(max ?? 0, ...values) || 1;
    return values
      .map((value, i) => `${(i / (values.length - 1)) * 100},${24 - (value / top) * 22 - 1}`)
      .join(' ');
  });
</script>

{#if points}
  <svg
    class="h-6 w-full overflow-visible"
    viewBox="0 0 100 24"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <polyline
      {points}
      fill="none"
      stroke={color}
      stroke-width="1.5"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}

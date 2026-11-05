<script lang="ts">
  import type { ServiceStatus } from '@ultimate-dash/shared';

  let { status }: { status: ServiceStatus | undefined } = $props();

  const state = $derived(status?.state ?? 'unknown');
  const label = $derived(
    state === 'up'
      ? `Online${status?.latencyMs != null ? `, ${status.latencyMs} ms` : ''}`
      : state === 'down'
        ? `Offline${status?.error ? `: ${status.error}` : ''}`
        : 'Status wird geprüft',
  );
</script>

<span class="inline-flex items-center gap-1.5 text-xs text-fg-muted tabular-nums" title={label}>
  <span class="relative flex size-2.5">
    {#if state === 'down'}
      <span class="absolute inline-flex size-full animate-ping rounded-full bg-down opacity-60"
      ></span>
    {/if}
    <span
      class="relative inline-flex size-2.5 rounded-full"
      class:bg-up={state === 'up'}
      class:bg-down={state === 'down'}
      class:bg-unknown={state === 'unknown'}
    ></span>
  </span>
  {#if state === 'up' && status?.latencyMs != null}
    <span aria-hidden="true">{status.latencyMs} ms</span>
  {:else if state === 'down'}
    <span aria-hidden="true" class="text-down">offline</span>
  {/if}
  <span class="sr-only">{label}</span>
</span>

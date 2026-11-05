<script lang="ts">
  import { toasts } from '$lib/toasts.svelte';
  import UiIcon from './UiIcon.svelte';
</script>

<div
  class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
  aria-live="polite"
>
  {#each toasts.items as toast (toast.id)}
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-elevated px-4 py-2.5 text-sm shadow-lg"
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <span class:text-up={toast.kind === 'success'} class:text-down={toast.kind === 'error'}>
        <UiIcon name={toast.kind === 'success' ? 'check' : 'x'} size={16} />
      </span>
      {toast.message}
    </div>
  {/each}
</div>

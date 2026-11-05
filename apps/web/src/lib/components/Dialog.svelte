<script lang="ts">
  import type { Snippet } from 'svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    size?: 'sm' | 'md';
  }

  let { open, title, onclose, children, footer, size = 'md' }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const titleId = `dialog-${Math.random().toString(36).slice(2)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<!-- Natives <dialog>: Fokusfalle, Escape und Barrierefreiheit kommen vom Browser. -->
<dialog
  bind:this={dialog}
  aria-labelledby={titleId}
  class="m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-elevated p-0 text-fg shadow-2xl"
  class:max-w-md={size === 'sm'}
  class:max-w-xl={size === 'md'}
  {onclose}
  onclick={(event) => {
    if (event.target === dialog) onclose();
  }}
>
  <div class="flex items-center justify-between border-b border-line px-5 py-4">
    <h2 id={titleId} class="text-lg font-semibold">{title}</h2>
    <button type="button" class="icon-btn" onclick={onclose} aria-label="Schließen">
      <UiIcon name="x" />
    </button>
  </div>
  <div class="max-h-[70dvh] overflow-y-auto px-5 py-4">
    {@render children()}
  </div>
  {#if footer}
    <div class="flex justify-end gap-2 border-t border-line px-5 py-3">
      {@render footer()}
    </div>
  {/if}
</dialog>

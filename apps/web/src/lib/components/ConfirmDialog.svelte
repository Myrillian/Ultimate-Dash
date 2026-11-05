<script lang="ts">
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onclose: () => void;
    onconfirm: () => Promise<void> | void;
  }

  let { open, title, message, confirmLabel = 'Löschen', onclose, onconfirm }: Props = $props();
  let busy = $state(false);

  async function confirm() {
    busy = true;
    try {
      await onconfirm();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} {title} size="sm">
  <p class="text-sm text-fg-muted">{message}</p>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="button" class="btn btn-danger" onclick={confirm} disabled={busy}
      >{confirmLabel}</button
    >
  {/snippet}
</Dialog>

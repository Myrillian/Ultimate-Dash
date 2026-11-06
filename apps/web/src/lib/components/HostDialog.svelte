<script lang="ts">
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    address: string;
    /** Bestehende Werte beim Bearbeiten eines bereits bestätigten Geräts */
    name?: string | null;
    confirmed?: boolean;
    onclose: () => void;
    onsubmit: (values: { name: string }) => Promise<void>;
  }
  let { open, address, name = null, confirmed = false, onclose, onsubmit }: Props = $props();

  let n = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    n = name ?? '';
    error = null;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await onsubmit({ name: n });
    } catch (e) {
      error =
        e instanceof ApiError && e.issues.length > 0
          ? e.issues.map((i) => i.message).join(' ')
          : e instanceof Error
            ? e.message
            : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title={confirmed ? 'Gerät bearbeiten' : 'Gerät bestätigen'} size="sm">
  <form id="host-form" class="grid gap-4" onsubmit={submit} novalidate>
    <p class="text-sm text-fg-muted">
      <span class="font-mono">{address}</span>
      {#if !confirmed}
        wurde per Ping gefunden und ist sonst nirgends eingetragen. Nach dem Bestätigen gilt die
        Adresse als bekannt und wird nicht mehr hervorgehoben.
      {/if}
    </p>
    {#if error}<p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
        {error}
      </p>{/if}
    <div>
      <label class="field-label" for="host-name">Name</label>
      <input id="host-name" class="input" bind:value={n} placeholder="z. B. Drucker Büro" />
    </div>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="host-form" class="btn btn-primary" disabled={busy}>
      {busy ? 'Speichert …' : confirmed ? 'Speichern' : 'Bestätigen'}
    </button>
  {/snippet}
</Dialog>

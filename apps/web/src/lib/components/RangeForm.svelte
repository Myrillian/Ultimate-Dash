<script lang="ts">
  import type { IpamCategory, IpamNetwork, IpamRange } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    network: IpamNetwork;
    categories: IpamCategory[];
    existing?: IpamRange | null;
    onclose: () => void;
    onsubmit: (values: {
      categoryId: number;
      startAddress: string;
      endAddress: string;
      label: string;
    }) => Promise<void>;
  }
  let { open, network, categories, existing = null, onclose, onsubmit }: Props = $props();

  let categoryId = $state(0);
  let startAddress = $state('');
  let endAddress = $state('');
  let label = $state('');
  let errors = $state<Record<string, string>>({});
  let general = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    errors = {};
    general = null;
    categoryId = existing?.categoryId ?? categories[0]?.id ?? 0;
    startAddress = existing?.startAddress ?? '';
    endAddress = existing?.endAddress ?? '';
    label = existing?.label ?? '';
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    errors = {};
    general = null;
    try {
      await onsubmit({
        categoryId,
        startAddress: startAddress.trim(),
        endAddress: endAddress.trim(),
        label,
      });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else general = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title={existing ? 'Bereich bearbeiten' : 'Neuer IP-Bereich'} size="sm">
  <form id="range-form" class="grid gap-4" onsubmit={submit} novalidate>
    <p class="text-sm text-fg-muted">Im Netz {network.name} ({network.cidr})</p>
    {#if general}
      <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{general}</p>
    {/if}
    <div>
      <label class="field-label" for="range-cat">Kategorie</label>
      <select id="range-cat" class="input" bind:value={categoryId}>
        {#each categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="range-start">Von</label>
        <input
          id="range-start"
          class="input font-mono"
          bind:value={startAddress}
          placeholder={network.cidr.replace(/\.\d+\/\d+$/, '.10')}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.startAddress}
        />
        {#if errors.startAddress}<p class="field-error">{errors.startAddress}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="range-end">Bis</label>
        <input
          id="range-end"
          class="input font-mono"
          bind:value={endAddress}
          placeholder={network.cidr.replace(/\.\d+\/\d+$/, '.49')}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.endAddress}
        />
        {#if errors.endAddress}<p class="field-error">{errors.endAddress}</p>{/if}
      </div>
    </div>
    <div>
      <label class="field-label" for="range-label">Bezeichnung (optional)</label>
      <input id="range-label" class="input" bind:value={label} placeholder="z. B. Proxmox-Hosts" />
    </div>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="range-form" class="btn btn-primary" disabled={busy || !categoryId}>
      {busy ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

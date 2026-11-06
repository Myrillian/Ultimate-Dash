<script lang="ts">
  import type { IpamNetwork } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';

  export interface NetworkValues {
    name: string;
    cidr: string;
    vlanId: string;
    gateway: string;
    description: string;
  }

  interface Props {
    open: boolean;
    existing?: IpamNetwork | null;
    onclose: () => void;
    onsubmit: (values: {
      name: string;
      cidr: string;
      vlanId: number | null;
      gateway: string;
      description: string;
    }) => Promise<void>;
  }
  let { open, existing = null, onclose, onsubmit }: Props = $props();

  let values = $state<NetworkValues>({
    name: '',
    cidr: '',
    vlanId: '',
    gateway: '',
    description: '',
  });
  let errors = $state<Record<string, string>>({});
  let general = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    errors = {};
    general = null;
    values = existing
      ? {
          name: existing.name,
          cidr: existing.cidr,
          vlanId: existing.vlanId?.toString() ?? '',
          gateway: existing.gateway ?? '',
          description: existing.description ?? '',
        }
      : { name: '', cidr: '', vlanId: '', gateway: '', description: '' };
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    errors = {};
    general = null;
    const vlan = String(values.vlanId ?? '').trim();
    try {
      await onsubmit({
        ...values,
        vlanId: vlan === '' ? null : Number(vlan),
      });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else general = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title={existing ? 'Netz bearbeiten' : 'Neues Netz'}>
  <form id="network-form" class="grid gap-4" onsubmit={submit} novalidate>
    {#if general}
      <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{general}</p>
    {/if}
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="net-name">Name</label>
        <input
          id="net-name"
          class="input"
          bind:value={values.name}
          placeholder="Heimnetz"
          aria-invalid={!!errors.name}
        />
        {#if errors.name}<p class="field-error">{errors.name}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="net-cidr">Netz (CIDR)</label>
        <input
          id="net-cidr"
          class="input font-mono"
          bind:value={values.cidr}
          placeholder="10.10.10.0/24"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.cidr}
        />
        {#if errors.cidr}<p class="field-error">{errors.cidr}</p>{/if}
      </div>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="net-gw">Gateway</label>
        <input
          id="net-gw"
          class="input font-mono"
          bind:value={values.gateway}
          placeholder="10.10.10.1"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.gateway}
        />
        {#if errors.gateway}<p class="field-error">{errors.gateway}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="net-vlan">VLAN-ID</label>
        <input
          id="net-vlan"
          class="input"
          inputmode="numeric"
          bind:value={values.vlanId}
          aria-invalid={!!errors.vlanId}
        />
        {#if errors.vlanId}<p class="field-error">{errors.vlanId}</p>{/if}
      </div>
    </div>
    <div>
      <label class="field-label" for="net-desc">Beschreibung</label>
      <input id="net-desc" class="input" bind:value={values.description} />
    </div>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="network-form" class="btn btn-primary" disabled={busy}>
      {busy ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

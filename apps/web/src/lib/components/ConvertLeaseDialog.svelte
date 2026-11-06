<script lang="ts">
  import { ApiError } from '$lib/api';
  import { fullName } from '$lib/dns-records';
  import Dialog from './Dialog.svelte';

  export interface ConvertValues {
    hostName: string;
    comments: string;
    dns: boolean;
    zone: string;
    createPtr: boolean;
  }

  interface Props {
    open: boolean;
    address: string;
    hostName: string | null;
    zones: string[];
    defaultZone: string | null;
    /** Es gibt schon einen A-Eintrag auf die Adresse */
    hasDns: boolean;
    onclose: () => void;
    onsubmit: (values: ConvertValues) => Promise<void>;
  }
  let { open, address, hostName, zones, defaultZone, hasDns, onclose, onsubmit }: Props = $props();

  let values = $state<ConvertValues>({
    hostName: '',
    comments: '',
    dns: false,
    zone: '',
    createPtr: true,
  });
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    values = {
      hostName: hostName ?? '',
      comments: '',
      dns: !hasDns && !!hostName && zones.length > 0,
      zone: defaultZone && zones.includes(defaultZone) ? defaultZone : (zones[0] ?? ''),
      createPtr: true,
    };
    error = null;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await onsubmit(values);
    } catch (e) {
      error = e instanceof ApiError || e instanceof Error ? e.message : 'Umwandeln fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="Lease in Reservierung umwandeln">
  <form id="convert-form" class="grid gap-4" onsubmit={submit}>
    <p class="text-sm text-fg-muted">
      Technitium kann eine laufende Lease nicht ändern. Sie wird deshalb zu einer Reservierung für
      <span class="font-mono">{address}</span>, dabei kannst du Name, Kommentar und DNS festlegen.
    </p>
    <label class="grid gap-1 text-sm">
      <span class="font-medium">Hostname</span>
      <input class="field" bind:value={values.hostName} autocomplete="off" />
    </label>
    <label class="grid gap-1 text-sm">
      <span class="font-medium">Kommentar</span>
      <input class="field" bind:value={values.comments} autocomplete="off" />
    </label>
    {#if hasDns}
      <p class="text-sm text-fg-muted">Es gibt schon einen DNS-Eintrag auf diese Adresse.</p>
    {:else if zones.length > 0}
      <div class="grid gap-2 rounded-xl border border-line p-3 text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={values.dns} />
          <span class="font-medium">DNS-Eintrag (A) anlegen</span>
        </label>
        {#if values.dns}
          <label class="grid gap-1">
            <span class="text-fg-muted">Zone</span>
            <select class="field" bind:value={values.zone}>
              {#each zones as zone (zone)}<option value={zone}>{zone}</option>{/each}
            </select>
          </label>
          <p class="text-fg-muted">
            Name: <span class="font-mono"
              >{values.hostName.trim() ? fullName(values.hostName, values.zone) : '–'}</span
            >
          </p>
          <label class="flex items-center gap-2">
            <input type="checkbox" bind:checked={values.createPtr} />
            PTR-Eintrag mit anlegen
          </label>
        {/if}
      </div>
    {/if}
    {#if error}<p class="text-sm text-down" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button
      type="submit"
      form="convert-form"
      class="btn btn-primary"
      disabled={busy || (values.dns && !values.hostName.trim())}
    >
      {busy ? 'Wandelt um …' : 'Umwandeln'}
    </button>
  {/snippet}
</Dialog>

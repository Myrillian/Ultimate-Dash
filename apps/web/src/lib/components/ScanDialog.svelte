<script lang="ts">
  import { SCAN_INTERVALS, type IpamScanStatus } from '@ultimate-dash/shared';
  import { api } from '$lib/api';
  import { formatAgo, formatDuration } from '$lib/format';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    status: IpamScanStatus | null;
    onclose: () => void;
    onchanged: () => Promise<void>;
  }
  let { open, status, onclose, onchanged }: Props = $props();

  let enabled = $state(true);
  let interval = $state(30);
  let error = $state<string | null>(null);
  let busy = $state<'save' | 'run' | null>(null);

  $effect(() => {
    if (!open || !status) return;
    enabled = status.enabled;
    interval = status.intervalMinutes;
    error = null;
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = 'save';
    error = null;
    try {
      await api.saveIpamScan({ enabled, intervalMinutes: interval });
      await onchanged();
      onclose();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = null;
    }
  }

  async function run() {
    busy = 'run';
    error = null;
    try {
      await api.runIpamScan();
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Start fehlgeschlagen';
    } finally {
      busy = null;
    }
  }
</script>

<Dialog {open} {onclose} title="Ping-Prüfung" size="sm">
  <form id="scan-form" class="grid gap-4" onsubmit={save}>
    <p class="text-sm text-fg-muted">
      Ultimate Dash pingt regelmäßig alle Adressen der Netze, bei denen die Prüfung aktiv ist (bis
      /22). So sieht man, ob bekannte Geräte erreichbar sind, und Geräte, die weder in DHCP noch im
      DNS stehen, werden als „entdeckt“ aufgenommen.
    </p>
    {#if error}<p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
        {error}
      </p>{/if}
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={enabled} /> Regelmäßig prüfen
    </label>
    <div>
      <label class="field-label" for="scan-interval">Abstand</label>
      <select id="scan-interval" class="input" bind:value={interval} disabled={!enabled}>
        {#each SCAN_INTERVALS as minutes (minutes)}
          <option value={minutes}>alle {formatDuration(minutes)}</option>
        {/each}
      </select>
      <p class="field-hint">
        Je Durchlauf geht ein Ping an jede Adresse, höchstens 32 gleichzeitig. Seltener prüfen
        schont das Netz.
      </p>
    </div>
    {#if status}
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt class="text-fg-muted">Letzter Durchlauf</dt>
        <dd>
          {#if status.running}läuft gerade …
          {:else if status.lastRunAt}{formatAgo(status.lastRunAt)} ({status.lastChecked}
            Adressen, {status.lastDurationSeconds} s)
          {:else}noch keiner seit dem Start{/if}
        </dd>
        {#if status.lastError}
          <dt class="text-fg-muted">Fehler</dt>
          <dd class="text-down">{status.lastError}</dd>
        {/if}
      </dl>
    {/if}
  </form>
  {#snippet footer()}
    <button
      type="button"
      class="btn mr-auto"
      disabled={busy !== null || status?.running}
      onclick={run}
    >
      {status?.running || busy === 'run' ? 'Läuft …' : 'Jetzt prüfen'}
    </button>
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="scan-form" class="btn btn-primary" disabled={busy !== null}>
      Speichern
    </button>
  {/snippet}
</Dialog>

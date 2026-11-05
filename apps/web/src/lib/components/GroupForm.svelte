<script lang="ts">
  import type { Group, GroupInput } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    group?: Group | null;
    onclose: () => void;
    onsubmit: (input: GroupInput) => Promise<void>;
  }

  let { open, group = null, onclose, onsubmit }: Props = $props();

  let name = $state('');
  let icon = $state('');
  let error = $state<string | null>(null);
  let saving = $state(false);

  $effect(() => {
    if (!open) return;
    name = group?.name ?? '';
    icon = group?.icon ?? '';
    error = null;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = null;
    try {
      await onsubmit({ name, icon, collapsed: group?.collapsed ?? false });
    } catch (err) {
      error =
        err instanceof ApiError && err.issues.length > 0
          ? (err.fieldErrors().name ?? err.message)
          : err instanceof Error
            ? err.message
            : 'Speichern fehlgeschlagen';
    } finally {
      saving = false;
    }
  }
</script>

<Dialog {open} {onclose} size="sm" title={group ? 'Gruppe bearbeiten' : 'Gruppe anlegen'}>
  <form id="group-form" class="grid gap-4" onsubmit={submit} novalidate>
    <div>
      <label class="field-label" for="grp-name">Name</label>
      <input
        id="grp-name"
        class="input"
        bind:value={name}
        required
        maxlength="80"
        placeholder="z. B. Infrastruktur"
        aria-invalid={!!error}
      />
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
    </div>
    <div>
      <label class="field-label" for="grp-icon"
        >Icon <span class="text-fg-muted">(optional)</span></label
      >
      <input id="grp-icon" class="input" bind:value={icon} placeholder="mdi:server" />
    </div>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="group-form" class="btn btn-primary" disabled={saving}>
      {saving ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

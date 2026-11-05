<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let repeat = $state('');
  let errors = $state<Record<string, string>>({});
  let generalError = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    currentPassword = newPassword = repeat = '';
    errors = {};
    generalError = null;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errors = {};
    generalError = null;
    if (newPassword !== repeat) {
      errors = { repeat: 'Die Passwörter stimmen nicht überein' };
      return;
    }
    busy = true;
    try {
      await api.changePassword({ currentPassword, newPassword });
      toasts.show('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
      onclose();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      // Ohne Feldangabe meldet der Server ein falsches aktuelles Passwort.
      else if (error instanceof ApiError && error.status === 400)
        errors = { currentPassword: error.message };
      else generalError = error instanceof Error ? error.message : 'Ändern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="Passwort ändern" size="sm">
  <form id="password-form" class="grid gap-4" onsubmit={submit} novalidate>
    {#if generalError}
      <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{generalError}</p>
    {/if}
    <div>
      <label class="field-label" for="pw-current">Aktuelles Passwort</label>
      <PasswordInput
        id="pw-current"
        bind:value={currentPassword}
        autocomplete="current-password"
        error={errors.currentPassword}
      />
    </div>
    <div>
      <label class="field-label" for="pw-new">Neues Passwort</label>
      <PasswordInput
        id="pw-new"
        bind:value={newPassword}
        autocomplete="new-password"
        error={errors.newPassword}
        hint="Mindestens 10 Zeichen."
      />
    </div>
    <div>
      <label class="field-label" for="pw-repeat">Neues Passwort wiederholen</label>
      <PasswordInput
        id="pw-repeat"
        bind:value={repeat}
        autocomplete="new-password"
        error={errors.repeat}
      />
    </div>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="password-form" class="btn btn-primary" disabled={busy}
      >Speichern</button
    >
  {/snippet}
</Dialog>

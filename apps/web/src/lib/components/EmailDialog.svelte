<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let email = $state('');
  let error = $state<string | undefined>();
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    email = auth.user?.email ?? '';
    error = undefined;
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = undefined;
    busy = true;
    try {
      auth.user = await api.changeEmail({ email });
      toasts.show(email ? 'E-Mail-Adresse gespeichert' : 'E-Mail-Adresse entfernt');
      onclose();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0) error = err.fieldErrors().email;
      else error = err instanceof Error ? err.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="E-Mail-Adresse" size="sm">
  <form id="email-form" class="grid gap-2" onsubmit={submit} novalidate>
    <label class="field-label" for="own-email">E-Mail-Adresse</label>
    <input
      id="own-email"
      class="input"
      type="email"
      bind:value={email}
      autocomplete="email"
      aria-invalid={!!error}
      aria-describedby="own-email-hint{error ? ' own-email-err' : ''}"
    />
    {#if error}<p id="own-email-err" class="field-error">{error}</p>{/if}
    <p id="own-email-hint" class="field-hint">
      {auth.passwordResetMail
        ? 'Hierhin schickt „Passwort vergessen“ den Link zum Zurücksetzen. Leer lassen, um sie zu entfernen.'
        : 'Wird für „Passwort vergessen“ genutzt, sobald der Mailversand eingerichtet ist. Bis dahin hilft ein Administrator.'}
    </p>
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="email-form" class="btn btn-primary" disabled={busy}
      >Speichern</button
    >
  {/snippet}
</Dialog>

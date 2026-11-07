<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { toasts } from '$lib/toasts.svelte';

  /** checking = Link wird geprüft, ready = Formular, invalid = Link ungültig */
  let phase = $state<'checking' | 'ready' | 'invalid'>('checking');
  let token = '';
  let username = $state('');
  let password = $state('');
  let repeat = $state('');
  let errors = $state<Record<string, string>>({});
  let generalError = $state<string | null>(null);
  let busy = $state(false);

  onMount(async () => {
    // Das Token steht im Fragment (#token=…), damit es in keinem Server- oder Proxy-Log landet.
    token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    history.replaceState(history.state, '', window.location.pathname);
    if (!token) {
      phase = 'invalid';
      return;
    }
    try {
      username = (await api.checkReset(token)).username;
      phase = 'ready';
    } catch {
      phase = 'invalid';
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errors = {};
    generalError = null;
    if (password !== repeat) {
      errors = { repeat: 'Die Passwörter stimmen nicht überein' };
      return;
    }
    busy = true;
    try {
      await auth.resetPassword({ token, password });
      toasts.show('Neues Passwort gespeichert. Du bist angemeldet.');
      await auth.load();
      await goto('/', { replaceState: true });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else if (error instanceof ApiError && error.status === 400) phase = 'invalid';
      else generalError = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Passwort zurücksetzen · Ultimate Dash</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-4 py-10">
  <div class="w-full max-w-sm">
    <div class="mb-6 flex flex-col items-center gap-3 text-center">
      <img src="/favicon.svg" alt="" width="48" height="48" />
      <h1 class="text-2xl font-semibold tracking-tight">Neues Passwort festlegen</h1>
      {#if phase === 'ready'}
        <p class="text-sm text-fg-muted">
          Für das Konto <strong class="text-fg">{username}</strong>. Danach wirst du auf allen
          anderen Geräten abgemeldet.
        </p>
      {/if}
    </div>

    <div class="rounded-2xl border border-line bg-elevated p-6 shadow-[var(--shadow)]">
      {#if phase === 'checking'}
        <p class="text-center text-sm text-fg-muted" aria-busy="true">Link wird geprüft …</p>
      {:else if phase === 'invalid'}
        <div class="grid gap-4">
          <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
            Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt. Fordere auf der
            Anmeldeseite über „Passwort vergessen?“ einen neuen an.
          </p>
          <a href="/" class="btn btn-primary w-full py-2.5">Zur Anmeldung</a>
        </div>
      {:else}
        <form class="grid gap-4" onsubmit={submit} novalidate>
          {#if generalError}
            <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
              {generalError}
            </p>
          {/if}
          <!-- Für Passwort-Manager, die den Benutzernamen zum neuen Passwort speichern -->
          <input
            type="text"
            class="sr-only"
            value={username}
            autocomplete="username"
            readonly
            tabindex="-1"
            aria-hidden="true"
          />
          <div>
            <label class="field-label" for="reset-pass">Neues Passwort</label>
            <PasswordInput
              id="reset-pass"
              bind:value={password}
              autocomplete="new-password"
              error={errors.password}
              hint="Mindestens 10 Zeichen. Ein langer Satz ist ideal."
            />
          </div>
          <div>
            <label class="field-label" for="reset-pass2">Passwort wiederholen</label>
            <PasswordInput
              id="reset-pass2"
              bind:value={repeat}
              autocomplete="new-password"
              error={errors.repeat}
            />
          </div>
          <button type="submit" class="btn btn-primary mt-1 w-full py-2.5" disabled={busy}>
            {busy ? 'Bitte warten …' : 'Passwort speichern'}
          </button>
        </form>
      {/if}
    </div>
  </div>
</main>

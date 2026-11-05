<script lang="ts">
  import { ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import PasswordInput from './PasswordInput.svelte';
  import UiIcon from './UiIcon.svelte';

  /** setup = Ersteinrichtung (erster Admin), login = Anmeldung */
  let { mode }: { mode: 'setup' | 'login' } = $props();

  let username = $state('');
  let password = $state('');
  let passwordRepeat = $state('');
  let busy = $state(false);
  let errors = $state<Record<string, string>>({});
  let generalError = $state<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errors = {};
    generalError = null;
    if (mode === 'setup' && password !== passwordRepeat) {
      errors = { passwordRepeat: 'Die Passwörter stimmen nicht überein' };
      return;
    }
    busy = true;
    auth.loginError = null;
    try {
      if (mode === 'setup') await auth.setup({ username, password });
      else await auth.login({ username, password });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else generalError = error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen';
      password = mode === 'login' ? '' : password;
    } finally {
      busy = false;
    }
  }
</script>

<main class="grid min-h-dvh place-items-center px-4 py-10">
  <div class="w-full max-w-sm">
    <div class="mb-6 flex flex-col items-center gap-3 text-center">
      <img src="/favicon.svg" alt="" width="48" height="48" />
      <h1 class="text-2xl font-semibold tracking-tight">
        {mode === 'setup' ? 'Willkommen bei Ultimate Dash' : 'Anmelden'}
      </h1>
      {#if mode === 'setup'}
        <p class="text-sm text-fg-muted">
          Lege zuerst ein Administrator-Konto an. Weitere Benutzer kannst du danach in der
          Benutzerverwaltung hinzufügen.
        </p>
      {/if}
    </div>

    <form
      class="grid gap-4 rounded-2xl border border-line bg-elevated p-6 shadow-[var(--shadow)]"
      onsubmit={submit}
      novalidate
    >
      {#if generalError ?? (mode === 'login' ? auth.loginError : null)}
        <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
          {generalError ?? auth.loginError}
        </p>
      {/if}

      {#if mode === 'login' && auth.oidc}
        <a href="/api/auth/oidc/start" class="btn btn-primary w-full py-2.5">
          <UiIcon name="key" size={16} />
          {auth.oidc.label}
        </a>
        <div class="flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
          <span class="h-px flex-1 bg-line"></span> oder mit Passwort
          <span class="h-px flex-1 bg-line"></span>
        </div>
      {/if}

      <div>
        <label class="field-label" for="auth-user">Benutzername</label>
        <input
          id="auth-user"
          class="input"
          bind:value={username}
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? 'auth-user-err' : undefined}
        />
        {#if errors.username}<p id="auth-user-err" class="field-error">{errors.username}</p>{/if}
      </div>

      <div>
        <label class="field-label" for="auth-pass">Passwort</label>
        <PasswordInput
          id="auth-pass"
          bind:value={password}
          autocomplete={mode === 'setup' ? 'new-password' : 'current-password'}
          error={errors.password}
          hint={mode === 'setup' ? 'Mindestens 10 Zeichen. Ein langer Satz ist ideal.' : undefined}
        />
      </div>

      {#if mode === 'setup'}
        <div>
          <label class="field-label" for="auth-pass2">Passwort wiederholen</label>
          <PasswordInput
            id="auth-pass2"
            bind:value={passwordRepeat}
            autocomplete="new-password"
            error={errors.passwordRepeat}
          />
        </div>
      {/if}

      <button
        type="submit"
        class="btn mt-1 w-full py-2.5"
        class:btn-primary={mode === 'setup' || !auth.oidc}
        disabled={busy}
      >
        {#if busy}Bitte warten …{:else if mode === 'setup'}Konto anlegen{:else}Anmelden{/if}
      </button>
    </form>
  </div>
</main>

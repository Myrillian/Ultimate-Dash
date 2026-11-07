<script lang="ts">
  import { RESET_PATH, roleLabels, type Role, type User } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';
  import UiIcon from './UiIcon.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let users = $state<User[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  /** Zeile, in der gerade ein Passwort zurückgesetzt oder das Löschen bestätigt wird. */
  let editing = $state<{ id: number; kind: 'password' | 'delete' | 'email' } | null>(null);
  let resetPassword = $state('');
  let resetError = $state<string | undefined>();
  /** Zuletzt erzeugter Reset-Link für die offene Zeile. */
  let resetLink = $state<{ url: string; expiresAt: string } | null>(null);
  let editEmail = $state('');
  let emailError = $state<string | undefined>();

  let form = $state({ username: '', password: '', role: 'viewer' as Role, email: '' });
  let formErrors = $state<Record<string, string>>({});
  let creating = $state(false);

  const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

  $effect(() => {
    if (!open) return;
    editing = null;
    form = { username: '', password: '', role: 'viewer', email: '' };
    formErrors = {};
    void load();
  });

  async function load() {
    loading = true;
    try {
      users = await api.listUsers();
      loadError = null;
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Laden fehlgeschlagen';
    } finally {
      loading = false;
    }
  }

  function fail(error: unknown) {
    toasts.show(error instanceof Error ? error.message : 'Aktion fehlgeschlagen', 'error');
  }

  async function changeRole(user: User, role: Role) {
    try {
      await api.updateUser(user.id, { role });
      toasts.show(`${user.username} ist jetzt ${roleLabels[role]}`);
    } catch (error) {
      fail(error);
    }
    await load();
  }

  function startEdit(user: User, kind: 'password' | 'delete' | 'email') {
    editing = editing?.id === user.id && editing.kind === kind ? null : { id: user.id, kind };
    resetPassword = '';
    resetError = undefined;
    resetLink = null;
    editEmail = user.email ?? '';
    emailError = undefined;
  }

  async function createLink(user: User) {
    try {
      const { token, expiresAt } = await api.createResetLink(user.id);
      resetLink = { url: `${window.location.origin}${RESET_PATH}#token=${token}`, expiresAt };
      await load();
    } catch (error) {
      fail(error);
    }
  }

  async function copyLink() {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.url);
      toasts.show('Link kopiert');
    } catch {
      toasts.show('Kopieren nicht möglich, bitte den Link markieren und kopieren', 'error');
    }
  }

  async function submitEmail(event: SubmitEvent, user: User) {
    event.preventDefault();
    try {
      await api.updateUser(user.id, { email: editEmail });
      toasts.show(
        editEmail ? `E-Mail-Adresse für ${user.username} gespeichert` : 'E-Mail-Adresse entfernt',
      );
      editing = null;
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0)
        emailError = error.fieldErrors().email;
      else if (error instanceof ApiError && error.status === 400) emailError = error.message;
      else fail(error);
    }
  }

  async function submitReset(event: SubmitEvent, user: User) {
    event.preventDefault();
    try {
      await api.updateUser(user.id, { password: resetPassword });
      toasts.show(`Passwort für ${user.username} gesetzt`);
      editing = null;
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0)
        resetError = error.fieldErrors().password;
      else fail(error);
    }
  }

  async function remove(user: User) {
    try {
      await api.deleteUser(user.id);
      toasts.show(`${user.username} gelöscht`);
      editing = null;
    } catch (error) {
      fail(error);
    }
    await load();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    creating = true;
    formErrors = {};
    try {
      const user = await api.createUser(form);
      toasts.show(`${user.username} angelegt`);
      form = { username: '', password: '', role: 'viewer', email: '' };
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) formErrors = error.fieldErrors();
      // Ohne Feldangabe: Benutzername oder E-Mail-Adresse ist bereits vergeben.
      else if (error instanceof ApiError && error.status === 400)
        formErrors = error.message.includes('E-Mail')
          ? { email: error.message }
          : { username: error.message };
      else fail(error);
    } finally {
      creating = false;
    }
  }
</script>

<Dialog {open} {onclose} title="Benutzer verwalten">
  <div class="grid gap-6">
    <section aria-labelledby="users-list-title">
      <h3 id="users-list-title" class="sr-only">Vorhandene Benutzer</h3>
      {#if loadError}
        <p class="text-sm text-down" role="alert">{loadError}</p>
      {:else if loading && users.length === 0}
        <p class="text-sm text-fg-muted">Lädt …</p>
      {:else}
        <ul class="grid divide-y divide-line rounded-xl border border-line">
          {#each users as user (user.id)}
            {@const self = user.id === auth.user?.id}
            <li class="grid gap-3 p-3">
              <div class="flex flex-wrap items-center gap-3">
                <span class="grid size-9 place-items-center rounded-full bg-muted text-fg-muted">
                  <UiIcon name="user" size={16} />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    {user.username}
                    {#if self}<span class="text-fg-muted">(du)</span>{/if}
                    {#if user.oidc}
                      <span
                        class="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-muted"
                        title="Meldet sich über den SSO-Anbieter an">SSO</span
                      >
                    {/if}
                  </p>
                  {#if user.resetRequestedAt}
                    <p class="text-xs font-medium text-accent">
                      Hat am {dateFormat.format(new Date(user.resetRequestedAt))} „Passwort vergessen“
                      angefragt
                    </p>
                  {/if}
                  <p class="truncate text-xs text-fg-muted">
                    {[
                      user.email,
                      user.lastLoginAt
                        ? `Zuletzt angemeldet ${dateFormat.format(new Date(user.lastLoginAt))}`
                        : 'Noch nie angemeldet',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <label class="sr-only" for="role-{user.id}">Rolle von {user.username}</label>
                <select
                  id="role-{user.id}"
                  class="input w-auto py-1.5"
                  value={user.role}
                  disabled={self}
                  title={self ? 'Die eigene Rolle kann nicht geändert werden' : undefined}
                  onchange={(event) => changeRole(user, event.currentTarget.value as Role)}
                >
                  <option value="admin">{roleLabels.admin}</option>
                  <option value="viewer">{roleLabels.viewer}</option>
                </select>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="E-Mail-Adresse von {user.username} ändern"
                  aria-expanded={editing?.id === user.id && editing.kind === 'email'}
                  onclick={() => startEdit(user, 'email')}
                >
                  <UiIcon name="mail" size={16} />
                </button>
                {#if !self}
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="{user.hasPassword
                      ? 'Passwort zurücksetzen'
                      : 'Lokales Passwort setzen'} für {user.username}"
                    aria-expanded={editing?.id === user.id && editing.kind === 'password'}
                    class:text-accent={!!user.resetRequestedAt}
                    onclick={() => startEdit(user, 'password')}
                  >
                    <UiIcon name="key" size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn hover:text-down"
                    aria-label="{user.username} löschen"
                    aria-expanded={editing?.id === user.id && editing.kind === 'delete'}
                    onclick={() => startEdit(user, 'delete')}
                  >
                    <UiIcon name="trash" size={16} />
                  </button>
                {/if}
              </div>

              {#if editing?.id === user.id && editing.kind === 'password'}
                <div class="grid gap-3 rounded-lg bg-muted/60 p-3">
                  <form
                    class="grid gap-2 sm:grid-cols-[1fr_auto]"
                    onsubmit={(e) => submitReset(e, user)}
                    novalidate
                  >
                    <div>
                      <label class="field-label" for="reset-{user.id}">Neues Passwort setzen</label>
                      <PasswordInput
                        id="reset-{user.id}"
                        bind:value={resetPassword}
                        autocomplete="new-password"
                        error={resetError}
                        hint="Der Benutzer wird auf allen Geräten abgemeldet."
                      />
                    </div>
                    <button type="submit" class="btn btn-primary self-start sm:mt-6">Setzen</button>
                  </form>
                  <div class="grid gap-2 border-t border-line pt-3">
                    <p class="text-sm">
                      Oder einen Link erzeugen, mit dem {user.username} selbst ein neues Passwort festlegt.
                    </p>
                    {#if resetLink}
                      <div class="flex gap-2">
                        <label class="sr-only" for="link-{user.id}">Reset-Link</label>
                        <input
                          id="link-{user.id}"
                          class="input font-mono text-xs"
                          readonly
                          value={resetLink.url}
                          onfocus={(e) => e.currentTarget.select()}
                        />
                        <button type="button" class="btn" onclick={copyLink}>
                          <UiIcon name="copy" size={16} /> Kopieren
                        </button>
                      </div>
                      <p class="field-hint">
                        Einmal verwendbar, gültig bis {dateFormat.format(
                          new Date(resetLink.expiresAt),
                        )}. Ein neuer Link macht diesen ungültig.
                      </p>
                    {:else}
                      <button
                        type="button"
                        class="btn justify-self-start"
                        onclick={() => createLink(user)}
                      >
                        <UiIcon name="link" size={16} /> Reset-Link erzeugen
                      </button>
                    {/if}
                  </div>
                </div>
              {:else if editing?.id === user.id && editing.kind === 'email'}
                <form
                  class="grid gap-2 sm:grid-cols-[1fr_auto]"
                  onsubmit={(e) => submitEmail(e, user)}
                  novalidate
                >
                  <div>
                    <label class="field-label" for="email-{user.id}">E-Mail-Adresse</label>
                    <input
                      id="email-{user.id}"
                      class="input"
                      type="email"
                      bind:value={editEmail}
                      autocomplete="off"
                      aria-invalid={!!emailError}
                      aria-describedby="email-{user.id}-hint"
                    />
                    {#if emailError}<p class="field-error">{emailError}</p>{/if}
                    <p id="email-{user.id}-hint" class="field-hint">
                      Für „Passwort vergessen“. Leer lassen, um sie zu entfernen.
                    </p>
                  </div>
                  <button type="submit" class="btn btn-primary self-start sm:mt-6">Speichern</button
                  >
                </form>
              {:else if editing?.id === user.id && editing.kind === 'delete'}
                <div
                  class="flex flex-wrap items-center gap-2 rounded-lg bg-down/10 px-3 py-2 text-sm"
                  role="alert"
                >
                  <span class="flex-1">„{user.username}“ wirklich löschen?</span>
                  <button type="button" class="btn py-1.5" onclick={() => (editing = null)}
                    >Abbrechen</button
                  >
                  <button type="button" class="btn btn-danger py-1.5" onclick={() => remove(user)}
                    >Löschen</button
                  >
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if auth.oidc?.rolesFromGroups && users.some((u) => u.oidc)}
          <p class="field-hint mt-2">
            Die Rolle von SSO-Benutzern wird bei jeder Anmeldung aus ihren Gruppen beim Anbieter
            übernommen. Änderungen hier gelten nur bis zur nächsten Anmeldung.
          </p>
        {/if}
        <p class="field-hint mt-2">
          {roleLabels.admin}: darf alles, auch IPAM, DHCP, DNS und Benutzer verwalten.
          {roleLabels.viewer}: bearbeitet das eigene Dashboard und sieht den Rest nur an.
        </p>
      {/if}
    </section>

    <section aria-labelledby="users-new-title" class="grid gap-3">
      <h3 id="users-new-title" class="text-sm font-semibold">Neuen Benutzer anlegen</h3>
      <form class="grid gap-3" onsubmit={create} novalidate>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="field-label" for="new-user">Benutzername</label>
            <input
              id="new-user"
              class="input"
              bind:value={form.username}
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              aria-invalid={!!formErrors.username}
              aria-describedby={formErrors.username ? 'new-user-err' : undefined}
            />
            {#if formErrors.username}<p id="new-user-err" class="field-error">
                {formErrors.username}
              </p>{/if}
          </div>
          <div>
            <label class="field-label" for="new-role">Rolle</label>
            <select id="new-role" class="input" bind:value={form.role}>
              <option value="viewer">{roleLabels.viewer}</option>
              <option value="admin">{roleLabels.admin}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="field-label" for="new-email">E-Mail-Adresse (optional)</label>
          <input
            id="new-email"
            class="input"
            type="email"
            bind:value={form.email}
            autocomplete="off"
            aria-invalid={!!formErrors.email}
            aria-describedby="new-email-hint"
          />
          {#if formErrors.email}<p class="field-error">{formErrors.email}</p>{/if}
          <p id="new-email-hint" class="field-hint">Für „Passwort vergessen“ per E-Mail.</p>
        </div>
        <div>
          <label class="field-label" for="new-pass">Passwort</label>
          <PasswordInput
            id="new-pass"
            bind:value={form.password}
            autocomplete="new-password"
            error={formErrors.password}
            hint="Mindestens 10 Zeichen."
          />
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn btn-primary" disabled={creating}>
            <UiIcon name="plus" size={16} /> Benutzer anlegen
          </button>
        </div>
      </form>
    </section>
  </div>
</Dialog>

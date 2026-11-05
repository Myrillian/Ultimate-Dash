<script lang="ts">
  import type { Role, User } from '@ultimate-dash/shared';
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
  let editing = $state<{ id: number; kind: 'password' | 'delete' } | null>(null);
  let resetPassword = $state('');
  let resetError = $state<string | undefined>();

  let form = $state({ username: '', password: '', role: 'viewer' as Role });
  let formErrors = $state<Record<string, string>>({});
  let creating = $state(false);

  const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

  $effect(() => {
    if (!open) return;
    editing = null;
    form = { username: '', password: '', role: 'viewer' };
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
      toasts.show(`${user.username} ist jetzt ${role === 'admin' ? 'Administrator' : 'Nur lesen'}`);
    } catch (error) {
      fail(error);
    }
    await load();
  }

  function startEdit(id: number, kind: 'password' | 'delete') {
    editing = editing?.id === id && editing.kind === kind ? null : { id, kind };
    resetPassword = '';
    resetError = undefined;
  }

  async function submitReset(event: SubmitEvent, user: User) {
    event.preventDefault();
    try {
      await api.updateUser(user.id, { password: resetPassword });
      toasts.show(`Passwort für ${user.username} gesetzt`);
      editing = null;
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
      form = { username: '', password: '', role: 'viewer' };
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) formErrors = error.fieldErrors();
      // Ohne Feldangabe kommt hier nur „Benutzername ist bereits vergeben“.
      else if (error instanceof ApiError && error.status === 400)
        formErrors = { username: error.message };
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
                  </p>
                  <p class="text-xs text-fg-muted">
                    {user.lastLoginAt
                      ? `Zuletzt angemeldet ${dateFormat.format(new Date(user.lastLoginAt))}`
                      : 'Noch nie angemeldet'}
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
                  <option value="admin">Administrator</option>
                  <option value="viewer">Nur lesen</option>
                </select>
                {#if !self}
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Passwort für {user.username} zurücksetzen"
                    aria-expanded={editing?.id === user.id && editing.kind === 'password'}
                    onclick={() => startEdit(user.id, 'password')}
                  >
                    <UiIcon name="key" size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn hover:text-down"
                    aria-label="{user.username} löschen"
                    aria-expanded={editing?.id === user.id && editing.kind === 'delete'}
                    onclick={() => startEdit(user.id, 'delete')}
                  >
                    <UiIcon name="trash" size={16} />
                  </button>
                {/if}
              </div>

              {#if editing?.id === user.id && editing.kind === 'password'}
                <form
                  class="grid gap-2 sm:grid-cols-[1fr_auto]"
                  onsubmit={(e) => submitReset(e, user)}
                  novalidate
                >
                  <div>
                    <label class="sr-only" for="reset-{user.id}">Neues Passwort</label>
                    <PasswordInput
                      id="reset-{user.id}"
                      bind:value={resetPassword}
                      autocomplete="new-password"
                      error={resetError}
                      hint="Der Benutzer wird auf allen Geräten abgemeldet."
                    />
                  </div>
                  <button type="submit" class="btn btn-primary self-start">Setzen</button>
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
              <option value="viewer">Nur lesen</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
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

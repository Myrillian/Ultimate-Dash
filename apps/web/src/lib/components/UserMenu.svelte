<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import PasswordDialog from './PasswordDialog.svelte';
  import UiIcon from './UiIcon.svelte';
  import UsersDialog from './UsersDialog.svelte';
  import ImportDialog from './ImportDialog.svelte';

  let open = $state(false);
  let passwordOpen = $state(false);
  let usersOpen = $state(false);
  let importOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

  const roleLabel = $derived(auth.user?.role === 'admin' ? 'Administrator' : 'Nur lesen');

  function close(returnFocus = false) {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function onWindowClick(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close(true);
    }
  }

  function choose(action: () => void) {
    close();
    action();
  }
</script>

<svelte:window onclick={onWindowClick} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" bind:this={root} onkeydown={onKeydown}>
  <button
    bind:this={trigger}
    type="button"
    class="icon-btn"
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls="user-menu"
    aria-label="Benutzermenü für {auth.user?.username}"
    onclick={() => (open = !open)}
  >
    <UiIcon name="user" />
  </button>

  {#if open}
    <div
      id="user-menu"
      class="absolute top-full right-0 z-20 mt-2 w-60 rounded-xl border border-line bg-elevated p-1.5 shadow-xl"
    >
      <div class="border-b border-line px-2.5 pt-1.5 pb-2.5">
        <p class="truncate text-sm font-medium">{auth.user?.username}</p>
        <p class="text-xs text-fg-muted">{roleLabel}</p>
      </div>
      <ul class="grid pt-1.5">
        <li>
          <button
            type="button"
            class="menu-item"
            onclick={() => choose(() => (passwordOpen = true))}
          >
            <UiIcon name="key" size={16} /> Passwort ändern
          </button>
        </li>
        {#if auth.isAdmin}
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (usersOpen = true))}
            >
              <UiIcon name="users" size={16} /> Benutzer verwalten
            </button>
          </li>
          <li class="mt-1 border-t border-line pt-1">
            <a href="/api/config/export" download class="menu-item" onclick={() => close()}>
              <UiIcon name="download" size={16} /> Konfiguration exportieren
            </a>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (importOpen = true))}
            >
              <UiIcon name="upload" size={16} /> Konfiguration importieren
            </button>
          </li>
        {/if}
        <li class="mt-1 border-t border-line pt-1">
          <button type="button" class="menu-item" onclick={() => choose(() => void auth.logout())}>
            <UiIcon name="logout" size={16} /> Abmelden
          </button>
        </li>
      </ul>
    </div>
  {/if}
</div>

<PasswordDialog open={passwordOpen} onclose={() => (passwordOpen = false)} />
{#if auth.isAdmin}
  <UsersDialog open={usersOpen} onclose={() => (usersOpen = false)} />
  <ImportDialog open={importOpen} onclose={() => (importOpen = false)} />
{/if}

<style>
  .menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.6rem;
    border-radius: 0.5rem;
    padding: 0.5rem 0.625rem;
    font-size: 0.875rem;
    text-align: left;
    color: var(--text);
  }
  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--bg-muted);
  }
</style>

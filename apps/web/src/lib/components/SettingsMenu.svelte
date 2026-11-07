<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import { menus } from '$lib/menus.svelte';
  import UiIcon from './UiIcon.svelte';
  import UsersDialog from './UsersDialog.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import CopyDialog from './CopyDialog.svelte';
  import TechnitiumDialog from './TechnitiumDialog.svelte';

  let open = $state(false);
  let usersOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

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
    aria-controls="settings-menu"
    aria-label="Einstellungen"
    title="Einstellungen"
    onclick={() => (open = !open)}
  >
    <UiIcon name="settings" />
  </button>

  {#if open}
    <div
      id="settings-menu"
      class="absolute top-full right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-elevated p-1.5 shadow-xl"
    >
      {#if auth.isAdmin}
        <section aria-labelledby="settings-admin">
          <h2 id="settings-admin" class="menu-heading">Admin</h2>
          <ul class="grid">
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (usersOpen = true))}
              >
                <UiIcon name="users" size={16} /> Benutzer verwalten
              </button>
            </li>
          </ul>
        </section>
        <section aria-labelledby="settings-connections" class="menu-section">
          <h2 id="settings-connections" class="menu-heading">Verbindungen</h2>
          <ul class="grid">
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.technitiumOpen = true))}
              >
                <UiIcon name="server" size={16} /> Technitium DNS
              </button>
            </li>
          </ul>
        </section>
      {/if}
      <section aria-labelledby="settings-backup" class:menu-section={auth.isAdmin}>
        <h2 id="settings-backup" class="menu-heading">Backup</h2>
        <ul class="grid">
          <li>
            <a href="/api/config/export" download class="menu-item" onclick={() => close()}>
              <UiIcon name="download" size={16} /> Mein Dashboard exportieren
            </a>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (menus.importOpen = true))}
            >
              <UiIcon name="upload" size={16} /> Mein Dashboard importieren
            </button>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (menus.copyOpen = true))}
            >
              <UiIcon name="copy" size={16} /> Von anderem Benutzer kopieren
            </button>
          </li>
        </ul>
      </section>
    </div>
  {/if}
</div>

<ImportDialog open={menus.importOpen} onclose={() => (menus.importOpen = false)} />
<CopyDialog open={menus.copyOpen} onclose={() => (menus.copyOpen = false)} />
{#if auth.isAdmin}
  <UsersDialog open={usersOpen} onclose={() => (usersOpen = false)} />
  <TechnitiumDialog open={menus.technitiumOpen} onclose={() => (menus.technitiumOpen = false)} />
{/if}

<style>
  .menu-section {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.25rem;
  }
  .menu-heading {
    padding: 0.375rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
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

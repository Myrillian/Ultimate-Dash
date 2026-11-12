<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import { layout } from '$lib/layout.svelte';
  import { menus } from '$lib/menus.svelte';
  import UiIcon from './UiIcon.svelte';
  import UsersDialog from './UsersDialog.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import CopyDialog from './CopyDialog.svelte';
  import TechnitiumDialog from './TechnitiumDialog.svelte';
  import ProxmoxDialog from './ProxmoxDialog.svelte';
  import ZoraxyDialog from './ZoraxyDialog.svelte';
  import MailDialog from './MailDialog.svelte';
  import FeedsDialog from './FeedsDialog.svelte';
  import DhcpServersDialog from './DhcpServersDialog.svelte';
  import UpdateDialog from './UpdateDialog.svelte';
  import { updates } from '$lib/update.svelte';

  let open = $state(false);
  let usersOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

  // Admins sehen schon im Menü, ob eine neue Version bereitsteht (die API fragt höchstens stündlich).
  $effect(() => {
    if (auth.isAdmin && !updates.status) void updates.load();
  });

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
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.updateOpen = true))}
              >
                <UiIcon name="download" size={16} /> Updates
                {#if updates.available}
                  <span
                    class="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs text-accent-contrast"
                    >Neu</span
                  >
                {/if}
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
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.technitiumServersOpen = true))}
              >
                <UiIcon name="server" size={16} /> Weitere Technitium-Server
              </button>
            </li>
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.proxmoxOpen = true))}
              >
                <UiIcon name="cpu" size={16} /> Proxmox VE
              </button>
            </li>
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.zoraxyOpen = true))}
              >
                <UiIcon name="network" size={16} /> Zoraxy
              </button>
            </li>
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.mailOpen = true))}
              >
                <UiIcon name="mail" size={16} /> Mailserver
              </button>
            </li>
            <li>
              <button
                type="button"
                class="menu-item"
                onclick={() => choose(() => (menus.feedsOpen = true))}
              >
                <UiIcon name="rss" size={16} /> Feeds verwalten
              </button>
            </li>
          </ul>
        </section>
      {/if}
      <section aria-labelledby="settings-view" class="menu-section">
        <h2 id="settings-view" class="menu-heading">Ansicht</h2>
        <ul class="grid">
          <li>
            <button type="button" class="menu-item" onclick={() => layout.toggle()}>
              <input type="checkbox" checked={layout.compact} tabindex="-1" aria-hidden="true" />
              Gruppen lückenlos anordnen
            </button>
          </li>
        </ul>
      </section>
      <section aria-labelledby="settings-backup" class="menu-section">
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
      <p class="menu-version" title="Installierte Version">Ultimate Dash v{__APP_VERSION__}</p>
    </div>
  {/if}
</div>

<ImportDialog open={menus.importOpen} onclose={() => (menus.importOpen = false)} />
<CopyDialog open={menus.copyOpen} onclose={() => (menus.copyOpen = false)} />
{#if auth.isAdmin}
  <UsersDialog open={usersOpen} onclose={() => (usersOpen = false)} />
  <TechnitiumDialog open={menus.technitiumOpen} onclose={() => (menus.technitiumOpen = false)} />
  <DhcpServersDialog
    open={menus.technitiumServersOpen}
    onclose={() => (menus.technitiumServersOpen = false)}
    onchange={() => {}}
  />
  <ProxmoxDialog open={menus.proxmoxOpen} onclose={() => (menus.proxmoxOpen = false)} />
  <ZoraxyDialog open={menus.zoraxyOpen} onclose={() => (menus.zoraxyOpen = false)} />
  <MailDialog open={menus.mailOpen} onclose={() => (menus.mailOpen = false)} />
  <FeedsDialog open={menus.feedsOpen} onclose={() => (menus.feedsOpen = false)} />
  <UpdateDialog open={menus.updateOpen} onclose={() => (menus.updateOpen = false)} />
{/if}

<style>
  .menu-section {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.25rem;
  }
  .menu-version {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    padding: 0.5rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    color: var(--text-muted);
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

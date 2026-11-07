<script lang="ts">
  import { roleLabels } from '@ultimate-dash/shared';
  import { auth } from '$lib/auth.svelte';
  import EmailDialog from './EmailDialog.svelte';
  import PasswordDialog from './PasswordDialog.svelte';
  import UiIcon from './UiIcon.svelte';

  let open = $state(false);
  let passwordOpen = $state(false);
  let emailOpen = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

  const roleLabel = $derived(auth.user ? roleLabels[auth.user.role] : '');

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
        <p class="text-xs text-fg-muted">{roleLabel}{auth.user?.oidc ? ' · SSO' : ''}</p>
      </div>
      <ul class="grid pt-1.5">
        {#if auth.user?.hasPassword}
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (passwordOpen = true))}
            >
              <UiIcon name="key" size={16} /> Passwort ändern
            </button>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onclick={() => choose(() => (emailOpen = true))}
            >
              <UiIcon name="mail" size={16} /> E-Mail-Adresse
            </button>
          </li>
        {/if}
        <li class={auth.user?.hasPassword ? 'mt-1 border-t border-line pt-1' : ''}>
          <button type="button" class="menu-item" onclick={() => choose(() => void auth.logout())}>
            <UiIcon name="logout" size={16} /> Abmelden
          </button>
        </li>
      </ul>
    </div>
  {/if}
</div>

<PasswordDialog open={passwordOpen} onclose={() => (passwordOpen = false)} />
<EmailDialog open={emailOpen} onclose={() => (emailOpen = false)} />

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

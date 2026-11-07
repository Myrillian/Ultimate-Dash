<script lang="ts">
  import { tick } from 'svelte';
  import { auth } from '$lib/auth.svelte';
  import UiIcon, { type UiIconName } from './UiIcon.svelte';

  type Entry = { href: string; label: string; hint: string; icon: UiIconName };

  // Bündelt die Netzwerk-Werkzeuge an einer Stelle der Kopfzeile.
  const entries = $derived<Entry[]>([
    { href: '/dns', label: 'Zonen und Records', hint: 'DNS-Zonen und Einträge', icon: 'globe' },
    { href: '/dhcp', label: 'DHCP', hint: 'Scopes, Leases, Reservierungen', icon: 'network' },
    { href: '/ipam', label: 'IPAM', hint: 'Netze und IP-Adressen', icon: 'grid' },
    // Das Änderungsprotokoll ist nur für Admins lesbar.
    ...(auth.isAdmin
      ? [
          {
            href: '/protokoll',
            label: 'Protokoll',
            hint: 'Wer hat was geändert',
            icon: 'history' as const,
          },
        ]
      : []),
  ]);

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  function links(): HTMLAnchorElement[] {
    return panel ? [...panel.querySelectorAll<HTMLAnchorElement>('a')] : [];
  }

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      links()[0]?.focus();
    }
  }

  function close(returnFocus = false) {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function onWindowClick(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = links();
      const index = items.indexOf(document.activeElement as HTMLAnchorElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" bind:this={root} onkeydown={onKeydown}>
  <button
    bind:this={trigger}
    type="button"
    class="icon-btn"
    class:bg-muted={open}
    class:text-fg={open}
    aria-haspopup="true"
    aria-expanded={open}
    aria-controls="net-menu"
    aria-label={open ? 'Netzwerk-Menü schließen' : 'Netzwerk-Menü öffnen'}
    onclick={toggle}
  >
    <span class="burger" class:open aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </span>
  </button>

  {#if open}
    <div
      bind:this={panel}
      id="net-menu"
      class="panel absolute top-full left-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-elevated p-1.5 shadow-xl"
    >
      <p class="px-2.5 pt-1.5 pb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
        Netzwerk
      </p>
      <nav aria-label="Netzwerk">
        <ul class="grid gap-0.5">
          {#each entries as entry (entry.href)}
            <li>
              <a href={entry.href} class="entry" onclick={() => close()}>
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-accent"
                >
                  <UiIcon name={entry.icon} size={18} />
                </span>
                <span class="grid min-w-0">
                  <span class="text-sm font-medium">{entry.label}</span>
                  <span class="truncate text-xs text-fg-muted">{entry.hint}</span>
                </span>
                <UiIcon name="back" size={16} class="chev ml-auto rotate-180 text-fg-muted" />
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    </div>
  {/if}
</div>

<style>
  .burger {
    position: relative;
    display: block;
    width: 18px;
    height: 14px;
  }
  .burger span {
    position: absolute;
    left: 0;
    height: 2px;
    width: 100%;
    border-radius: 9999px;
    background: currentColor;
    transition:
      transform 200ms ease,
      opacity 150ms ease,
      top 200ms ease;
  }
  .burger span:nth-child(1) {
    top: 0;
  }
  .burger span:nth-child(2) {
    top: 6px;
  }
  .burger span:nth-child(3) {
    top: 12px;
  }
  .burger.open span:nth-child(1) {
    top: 6px;
    transform: rotate(45deg);
  }
  .burger.open span:nth-child(2) {
    opacity: 0;
  }
  .burger.open span:nth-child(3) {
    top: 6px;
    transform: rotate(-45deg);
  }
  .panel {
    transform-origin: top left;
    animation: pop 140ms ease-out;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.97);
    }
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border-radius: 0.75rem;
    padding: 0.5rem 0.625rem;
    color: var(--text);
    transition: background 120ms ease;
  }
  .entry:hover,
  .entry:focus-visible {
    background: var(--bg-muted);
    outline: none;
  }
  .entry :global(.chev) {
    opacity: 0;
    transition:
      opacity 120ms ease,
      transform 120ms ease;
  }
  .entry:hover :global(.chev),
  .entry:focus-visible :global(.chev) {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .burger span,
    .panel,
    .entry :global(.chev) {
      transition: none;
      animation: none;
    }
  }
</style>

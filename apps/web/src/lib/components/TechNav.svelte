<script lang="ts">
  import { page } from '$app/state';
  import { auth } from '$lib/auth.svelte';

  // Reihenfolge wie im Konzept: IPs als Hauptseite, dann Zonen, Scopes und Protokoll.
  const links = $derived([
    { href: '/ipam', label: 'IPs' },
    { href: '/dns', label: 'Zonen' },
    { href: '/dhcp', label: 'Scopes' },
    // Das Änderungsprotokoll ist nur für Admins lesbar.
    ...(auth.isAdmin ? [{ href: '/protokoll', label: 'Protokoll' }] : []),
  ]);
</script>

<nav aria-label="Netzwerk" class="inline-flex rounded-lg border border-line bg-elevated p-0.5">
  {#each links as link (link.href)}
    {@const current = page.url.pathname === link.href}
    <a
      href={link.href}
      aria-current={current ? 'page' : undefined}
      class="rounded-md px-3 py-1 text-sm font-medium transition"
      class:bg-muted={current}
      class:text-fg-muted={!current}>{link.label}</a
    >
  {/each}
</nav>

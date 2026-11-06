<script lang="ts">
  import { page } from '$app/state';

  const links = [
    { href: '/dns', label: 'DNS' },
    { href: '/dhcp', label: 'DHCP' },
  ];
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

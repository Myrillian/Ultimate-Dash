<script lang="ts">
  import type { IpamSuggestion } from '@ultimate-dash/shared';

  interface Props {
    suggestions: IpamSuggestion[];
    onimport: (scopes: string[], withPoolRange: boolean) => Promise<void>;
  }
  let { suggestions, onimport }: Props = $props();

  let chosen = $state<string[]>([]);
  let withPool = $state(true);
  let busy = $state(false);

  // Vorauswahl: alles, was sich ohne Überschneidung übernehmen lässt.
  $effect(() => {
    chosen = suggestions.filter((s) => !s.overlaps).map((s) => s.scope);
  });

  async function submit() {
    busy = true;
    try {
      await onimport(chosen, withPool);
    } finally {
      busy = false;
    }
  }
</script>

<section
  aria-label="Netze aus Technitium übernehmen"
  class="grid gap-3 rounded-2xl border border-accent/40 bg-elevated p-4"
>
  <div>
    <h3 class="font-semibold">In Technitium gefunden</h3>
    <p class="text-sm text-fg-muted">
      Diese DHCP-Scopes haben noch kein Netz im IPAM. Beim Übernehmen werden Name, Netz, Gateway und
      Domäne aus Technitium eingetragen.
    </p>
  </div>
  <ul class="grid gap-1">
    {#each suggestions as s (s.scope)}
      <li>
        <label
          class="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted"
          class:opacity-60={!!s.overlaps}
        >
          <input
            type="checkbox"
            class="mt-1"
            value={s.scope}
            bind:group={chosen}
            disabled={!!s.overlaps}
          />
          <span class="min-w-0 flex-1">
            <span class="font-medium">{s.scope}</span>
            <span class="ml-2 font-mono text-xs text-fg-muted">{s.cidr}</span>
            <span class="block text-xs text-fg-muted">
              {#if s.overlaps}
                Überschneidet sich mit {s.overlaps}. Passe das bestehende Netz an, um zu übernehmen.
              {:else}
                {#if s.gateway}Gateway {s.gateway} ·{/if}
                {#if s.pools.length > 0}
                  DHCP-Pool {s.pools.map((p) => `${p.start} – ${p.end}`).join(', ')}
                {:else}kein verteilbarer Bereich{/if}
              {/if}
            </span>
          </span>
        </label>
      </li>
    {/each}
  </ul>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={withPool} />
    DHCP-Pool als Bereich der Kategorie „DHCP“ anlegen
  </label>
  <div>
    <button
      type="button"
      class="btn btn-primary"
      disabled={busy || chosen.length === 0}
      onclick={submit}
    >
      {busy
        ? 'Übernimmt …'
        : chosen.length > 1
          ? `${chosen.length} Netze übernehmen`
          : 'Netz übernehmen'}
    </button>
  </div>
</section>

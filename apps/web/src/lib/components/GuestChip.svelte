<script lang="ts">
  import type { ProxmoxGuestCount } from '@ultimate-dash/shared';

  /** „VMs 4/6“ im Balken; zeigt beim Draufzeigen, Fokussieren oder Antippen die gestoppten Gäste. */
  let { label, count, id }: { label: string; count: ProxmoxGuestCount; id: string } = $props();

  let hover = $state(false);
  let pinned = $state(false);
  let root: HTMLDivElement | undefined = $state();
  const open = $derived(hover || pinned);
  const allUp = $derived(count.running === count.total);
</script>

<svelte:window
  onclick={(event) => {
    if (pinned && root && !root.contains(event.target as Node)) pinned = false;
  }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative"
  bind:this={root}
  onmouseenter={() => (hover = true)}
  onmouseleave={() => (hover = false)}
  onkeydown={(event) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      hover = false;
      pinned = false;
    }
  }}
>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-xs whitespace-nowrap text-fg-muted tabular-nums hover:bg-muted hover:text-fg"
    aria-expanded={open}
    aria-controls={id}
    onclick={() => (pinned = !pinned)}
    onfocus={() => (hover = true)}
    onblur={() => (hover = false)}
  >
    <span
      class="size-2 rounded-full"
      class:bg-up={allUp}
      class:bg-unknown={!allUp}
      aria-hidden="true"
    ></span>
    {label}
    <b class="font-semibold text-fg">{count.running}/{count.total}</b>
    <span class="sr-only">laufen</span>
  </button>
  {#if open}
    <div
      {id}
      class="absolute top-full right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-elevated p-2 text-xs shadow-xl"
    >
      {#if count.notRunning.length === 0}
        <p class="text-fg-muted">Alle {count.total} {label} laufen.</p>
      {:else}
        <p class="mb-1 font-medium">Nicht gestartet</p>
        <ul class="grid max-h-60 gap-0.5 overflow-y-auto">
          {#each count.notRunning as guest (guest.id)}
            <li class="flex items-baseline gap-2">
              <span class="w-10 shrink-0 text-fg-muted tabular-nums">{guest.id}</span>
              <span class="min-w-0 flex-1 truncate">{guest.name}</span>
              {#if guest.status !== 'stopped'}
                <span class="text-fg-muted"
                  >{guest.status === 'paused' ? 'pausiert' : guest.status}</span
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

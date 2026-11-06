<script lang="ts">
  import { onMount } from 'svelte';
  import type { SavedView, ViewScope } from '@ultimate-dash/shared';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { toasts } from '$lib/toasts.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    scope: ViewScope;
    /** Parameter der Adresszeile, die zur Ansicht gehören (q, type, sort …). */
    keys: readonly string[];
    /** Aktuell ausgeblendete Spalten (leer, wenn die Liste keine hat). */
    hidden?: string[];
    onapply: (params: Record<string, string>, hidden: string[]) => void;
  }
  let { scope, keys, hidden = [], onapply }: Props = $props();

  let views = $state<SavedView[]>([]);
  let name = $state('');
  let busy = $state(false);
  let menu = $state<HTMLDetailsElement>();

  const current = $derived(
    Object.fromEntries(
      keys.map((key) => [key, page.url.searchParams.get(key) ?? '']).filter(([, v]) => v !== ''),
    ) as Record<string, string>,
  );

  async function load() {
    try {
      views = await api.views(scope);
    } catch {
      views = [];
    }
  }
  onMount(load);

  function apply(view: SavedView) {
    onapply(view.params, view.hidden);
    if (menu) menu.open = false;
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    busy = true;
    try {
      const replaced = views.some((v) => v.name === trimmed);
      await api.saveView({ scope, name: trimmed, params: current, hidden });
      toasts.show(replaced ? 'Ansicht aktualisiert' : 'Ansicht gespeichert');
      name = '';
      await load();
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : 'Speichern fehlgeschlagen', 'error');
    } finally {
      busy = false;
    }
  }

  async function remove(view: SavedView) {
    try {
      await api.deleteView(view.id);
      views = views.filter((v) => v.id !== view.id);
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : 'Löschen fehlgeschlagen', 'error');
    }
  }
</script>

<details class="relative" name="filter-menu" bind:this={menu}>
  <summary class="btn cursor-pointer px-2.5 py-1 text-xs">Ansichten</summary>
  <div
    class="absolute right-0 z-20 mt-1 grid w-64 gap-2 rounded-xl border border-line bg-elevated p-2 text-sm shadow-xl"
  >
    {#if views.length > 0}
      <ul class="grid gap-0.5">
        {#each views as view (view.id)}
          <li class="flex items-center gap-1">
            <button
              type="button"
              class="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left hover:bg-muted"
              onclick={() => apply(view)}>{view.name}</button
            >
            <button
              type="button"
              class="icon-btn hover:text-down"
              aria-label="Ansicht {view.name} löschen"
              onclick={() => remove(view)}
            >
              <UiIcon name="trash" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="px-2 py-1 text-xs text-fg-muted">Noch keine gespeicherten Ansichten.</p>
    {/if}
    <form
      class="flex gap-1 border-t border-line pt-2"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label class="sr-only" for="view-name-{scope}">Name der Ansicht</label>
      <input
        id="view-name-{scope}"
        class="input min-w-0 flex-1 py-1 text-xs"
        placeholder="Aktuelle Ansicht speichern als …"
        maxlength="60"
        bind:value={name}
      />
      <button type="submit" class="btn px-2.5 py-1 text-xs" disabled={busy || !name.trim()}
        >Speichern</button
      >
    </form>
  </div>
</details>

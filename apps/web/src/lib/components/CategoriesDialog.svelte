<script lang="ts">
  import type { CategoryColor, IpamCategory, IpamRange } from '@ultimate-dash/shared';
  import { categoryColors } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { categoryColor, colorNames } from '$lib/ipam';
  import Dialog from './Dialog.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    open: boolean;
    categories: IpamCategory[];
    ranges: IpamRange[];
    onclose: () => void;
    onchanged: () => Promise<void>;
  }
  let { open, categories, ranges, onclose, onchanged }: Props = $props();

  /** null = Liste, 0 = neu, sonst Kategorie-ID */
  let editing = $state<number | null>(null);
  let name = $state('');
  let color = $state<CategoryColor>('blue');
  let description = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let pendingDelete = $state<IpamCategory | null>(null);

  $effect(() => {
    if (open) {
      editing = null;
      pendingDelete = null;
    }
  });

  function edit(category: IpamCategory | null) {
    editing = category?.id ?? 0;
    name = category?.name ?? '';
    // Neue Kategorie: erste noch unbenutzte Farbe
    color =
      category?.color ??
      categoryColors.find((c) => !categories.some((x) => x.color === c)) ??
      categoryColors[0];
    description = category?.description ?? '';
    error = null;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      const input = { name, color, description };
      if (editing) await api.updateIpamCategory(editing, input);
      else await api.createIpamCategory(input);
      await onchanged();
      editing = null;
    } catch (e) {
      error =
        e instanceof ApiError && e.issues.length > 0
          ? Object.values(e.fieldErrors()).join(' ')
          : e instanceof Error
            ? e.message
            : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  const rangeCount = (category: IpamCategory) =>
    ranges.filter((r) => r.categoryId === category.id).length;

  async function remove() {
    if (!pendingDelete) return;
    busy = true;
    try {
      await api.deleteIpamCategory(pendingDelete.id);
      pendingDelete = null;
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Löschen fehlgeschlagen';
      pendingDelete = null;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="Kategorien">
  {#if pendingDelete}
    <p class="text-sm">
      Kategorie <strong>{pendingDelete.name}</strong> löschen?
      {#if rangeCount(pendingDelete) > 0}
        Die {rangeCount(pendingDelete)} zugehörigen IP-Bereiche werden mit entfernt.
      {/if}
      Die Adressen selbst bleiben in Technitium unverändert.
    </p>
  {:else if editing === null}
    {#if error}<p class="mb-3 rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
        {error}
      </p>{/if}
    {#if categories.length === 0}
      <p class="text-sm text-fg-muted">
        Noch keine Kategorien. Mit Kategorien wie „Server“, „Clients“ oder „IoT“ gliederst du die
        Adressen eines Netzes und siehst sie farbig im Raster.
      </p>
    {:else}
      <ul class="grid gap-1">
        {#each categories as category (category.id)}
          <li class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted">
            <span
              class="size-4 shrink-0 rounded"
              style="background: {categoryColor(category.color)}"
              title={colorNames[category.color]}
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{category.name}</span>
              {#if category.description}
                <span class="block truncate text-xs text-fg-muted">{category.description}</span>
              {/if}
            </span>
            <button
              type="button"
              class="icon-btn"
              aria-label="{category.name} bearbeiten"
              onclick={() => edit(category)}
            >
              <UiIcon name="pencil" size={16} />
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="{category.name} löschen"
              onclick={() => (pendingDelete = category)}
            >
              <UiIcon name="trash" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <form id="category-form" class="grid gap-4" onsubmit={save} novalidate>
      {#if error}<p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">
          {error}
        </p>{/if}
      <div>
        <label class="field-label" for="cat-name">Name</label>
        <input id="cat-name" class="input" bind:value={name} placeholder="Server" />
      </div>
      <fieldset>
        <legend class="field-label">Farbe</legend>
        <div class="flex flex-wrap gap-2">
          {#each categoryColors as c (c)}
            <label class="cursor-pointer">
              <input
                type="radio"
                class="peer sr-only"
                name="cat-color"
                value={c}
                bind:group={color}
              />
              <span
                class="block size-8 rounded-lg ring-offset-2 ring-offset-elevated peer-checked:ring-2 peer-checked:ring-fg peer-focus-visible:outline-2"
                style="background: {categoryColor(c)}"
                title={colorNames[c]}
              ></span>
              <span class="sr-only">{colorNames[c]}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <div>
        <label class="field-label" for="cat-desc">Beschreibung (optional)</label>
        <input id="cat-desc" class="input" bind:value={description} />
      </div>
    </form>
  {/if}
  {#snippet footer()}
    {#if pendingDelete}
      <button type="button" class="btn" onclick={() => (pendingDelete = null)}>Abbrechen</button>
      <button type="button" class="btn btn-danger" onclick={remove} disabled={busy}>Löschen</button>
    {:else if editing === null}
      <button type="button" class="btn" onclick={onclose}>Fertig</button>
      <button type="button" class="btn btn-primary" onclick={() => edit(null)}>
        <UiIcon name="plus" size={16} /> Neue Kategorie
      </button>
    {:else}
      <button type="button" class="btn" onclick={() => (editing = null)}>Zurück</button>
      <button
        type="submit"
        form="category-form"
        class="btn btn-primary"
        disabled={busy || !name.trim()}
      >
        {busy ? 'Speichert …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

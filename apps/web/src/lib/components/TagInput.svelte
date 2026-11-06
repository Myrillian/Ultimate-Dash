<script lang="ts">
  import { normalize } from '$lib/search';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    id: string;
    value: string[];
    /** Bereits verwendete Tags (aus allen Services) als Vorschläge. */
    suggestions: string[];
    max?: number;
  }

  let { id, value = $bindable(), suggestions, max = 20 }: Props = $props();

  let text = $state('');
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const matches = $derived.by(() => {
    const needle = normalize(text.trim());
    const taken = new Set(value.map((tag) => tag.toLowerCase()));
    return suggestions
      .filter((tag) => !taken.has(tag.toLowerCase()))
      .filter((tag) => !needle || normalize(tag).includes(needle))
      .sort((a, b) => {
        const aStart = normalize(a).startsWith(needle) ? 0 : 1;
        const bStart = normalize(b).startsWith(needle) ? 0 : 1;
        return aStart - bStart || a.localeCompare(b, 'de');
      });
  });
  const canCreate = $derived(
    text.trim().length > 0 &&
      !value.some((tag) => tag.toLowerCase() === text.trim().toLowerCase()) &&
      !matches.some((tag) => tag.toLowerCase() === text.trim().toLowerCase()),
  );
  /** Einträge der Liste: Vorschläge, dazu ggf. „neu anlegen“ am Ende. */
  const entries = $derived([
    ...matches.map((tag) => ({ tag, isNew: false })),
    ...(canCreate ? [{ tag: text.trim(), isNew: true }] : []),
  ]);

  $effect(() => {
    void text;
    active = 0;
  });

  function add(tag: string) {
    const clean = tag.trim().slice(0, 40);
    if (!clean || value.length >= max) return;
    if (!value.some((t) => t.toLowerCase() === clean.toLowerCase())) value = [...value, clean];
    text = '';
    input?.focus();
  }

  function remove(tag: string) {
    value = value.filter((t) => t !== tag);
    input?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open = true;
      active = Math.min(active + 1, entries.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (event.key === 'Enter' || event.key === ',') {
      if (event.key === 'Enter' && !text.trim() && !open) return;
      event.preventDefault();
      const entry = open ? entries[active] : undefined;
      if (entry) add(entry.tag);
      else if (text.trim()) add(text);
    } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
      value = value.slice(0, -1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
</script>

<div class="relative">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-accent"
    onclick={() => input?.focus()}
  >
    {#each value as tag (tag)}
      <span
        class="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs font-medium"
      >
        {tag}
        <button
          type="button"
          class="grid size-4 place-items-center rounded text-fg-muted hover:text-fg"
          aria-label="Tag {tag} entfernen"
          onclick={(event) => {
            event.stopPropagation();
            remove(tag);
          }}
        >
          <UiIcon name="x" size={12} />
        </button>
      </span>
    {/each}
    <input
      bind:this={input}
      {id}
      bind:value={text}
      class="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted/70 focus-visible:outline-none"
      placeholder={value.length === 0 ? 'Tag wählen oder neu eingeben' : ''}
      role="combobox"
      aria-expanded={open && entries.length > 0}
      aria-controls="{id}-list"
      aria-autocomplete="list"
      aria-activedescendant={open && entries[active] ? `${id}-opt-${active}` : undefined}
      aria-describedby="{id}-hint"
      autocomplete="off"
      spellcheck="false"
      maxlength="40"
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 120)}
      oninput={() => (open = true)}
      onkeydown={onKeydown}
    />
  </div>

  {#if open && entries.length > 0}
    <ul
      id="{id}-list"
      role="listbox"
      aria-label="Tags"
      class="absolute inset-x-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-xl"
    >
      {#each entries as entry, index (entry.tag + entry.isNew)}
        <li
          id="{id}-opt-{index}"
          role="option"
          aria-selected={index === active}
          class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm"
          class:bg-muted={index === active}
          onmousedown={(event) => {
            // mousedown statt click, damit das Feld den Fokus nicht vorher verliert
            event.preventDefault();
            add(entry.tag);
          }}
          onmouseenter={() => (active = index)}
        >
          {#if entry.isNew}
            <UiIcon name="plus" size={14} />
            <span>„{entry.tag}“ neu anlegen</span>
          {:else}
            <span>{entry.tag}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
<p id="{id}-hint" class="field-hint">
  Aus der Liste wählen oder neu eingeben und mit Enter übernehmen. Tags werden bei der Suche
  berücksichtigt.
</p>

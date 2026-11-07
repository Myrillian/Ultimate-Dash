<script lang="ts" module>
  import type { IconCatalog } from '@ultimate-dash/shared';
  import { api } from '$lib/api';

  // Das Verzeichnis wird nur einmal pro Sitzung geladen.
  let catalogPromise: Promise<IconCatalog> | null = null;
  function loadCatalog() {
    catalogPromise ??= api.iconCatalog().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
    return catalogPromise;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import {
    iconifyOptions,
    searchCatalog,
    sourceLabels,
    type IconOption,
    type IconSource,
  } from '$lib/icon-search';
  import { resolveIcon } from '$lib/icons';
  import ServiceIcon from './ServiceIcon.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    id: string;
    value: string;
    /** Name des Services oder der Gruppe: Vorschlag für die Suche und Initialen in der Vorschau. */
    name: string;
    /** Suche beim Öffnen mit dem Namen vorbelegen (passt bei Services, selten bei Gruppen). */
    prefill?: boolean;
  }

  let { id, value = $bindable(), name, prefill = true }: Props = $props();

  const PAGE = 120;
  let open = $state(false);
  let query = $state('');
  let source = $state<'all' | IconSource>('all');
  let catalog = $state<IconCatalog | null>(null);
  let loadError = $state<string | null>(null);
  let iconify = $state<IconOption[]>([]);
  let iconifyState = $state<'idle' | 'loading' | 'error'>('idle');
  let limit = $state(PAGE);
  let searchInput: HTMLInputElement | undefined = $state();
  let toggle: HTMLButtonElement | undefined = $state();
  let sentinel: HTMLDivElement | undefined = $state();
  let grid: HTMLDivElement | undefined = $state();

  const catalogOptions = $derived(
    catalog && source !== 'iconify'
      ? searchCatalog(catalog, query, source === 'all' ? ['di', 'sh'] : [source])
      : [],
  );
  const options = $derived(
    source === 'iconify'
      ? iconify
      : source === 'all'
        ? [...catalogOptions.slice(0, 40), ...iconify, ...catalogOptions.slice(40)]
        : catalogOptions,
  );
  const visible = $derived(options.slice(0, limit));
  const wantsIconify = $derived(
    (source === 'all' || source === 'iconify') && query.trim().length >= 2,
  );

  function show() {
    open = true;
    // Ohne Icon mit dem Service-Namen vorbelegen: meist ist das passende Icon gleich dabei.
    if (prefill && !value.trim() && !query) query = name.trim();
    loadError = null;
    loadCatalog()
      .then((result) => (catalog = result))
      .catch((error: unknown) => {
        loadError = error instanceof Error ? error.message : 'Icons konnten nicht geladen werden';
      });
    queueMicrotask(() => searchInput?.focus());
  }

  function hide(returnFocus = true) {
    open = false;
    if (returnFocus) toggle?.focus();
  }

  function choose(option: IconOption) {
    value = option.value;
    hide();
  }

  // Neue Suche → wieder oben anfangen.
  $effect(() => {
    void query;
    void source;
    limit = PAGE;
    grid?.scrollTo({ top: 0 });
  });

  // Iconify erst nach einer kurzen Tipppause abfragen.
  $effect(() => {
    if (!open || !wantsIconify) {
      untrack(() => (iconify = []));
      return;
    }
    const q = query.trim();
    iconifyState = 'loading';
    const timer = setTimeout(() => {
      api
        .searchIconify(q)
        .then((result) => {
          if (query.trim() !== q) return;
          iconify = iconifyOptions(result.icons);
          iconifyState = 'idle';
        })
        .catch(() => {
          iconify = [];
          iconifyState = 'error';
        });
    }, 300);
    return () => clearTimeout(timer);
  });

  // Beim Scrollen ans Ende weitere Icons nachladen.
  $effect(() => {
    if (!sentinel || !grid) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) limit += PAGE;
      },
      { root: grid, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  /** Pfeiltasten bewegen den Fokus im Raster, Pos1/Ende springen an den Rand. */
  function onGridKeydown(event: KeyboardEvent) {
    const buttons = [...(grid?.querySelectorAll<HTMLButtonElement>('button[data-icon]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const top = buttons[0]!.offsetTop;
    const columns = Math.max(1, buttons.filter((b) => b.offsetTop === top).length);
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
      Home: -index,
      End: buttons.length - 1 - index,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (index + move < 0) {
      searchInput?.focus();
      return;
    }
    buttons[Math.min(buttons.length - 1, index + move)]?.focus();
  }

  function onPanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      // Nur die Auswahl schließen, nicht den ganzen Dialog.
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      grid?.querySelector<HTMLButtonElement>('button[data-icon]')?.focus();
    } else if (event.key === 'Enter') {
      // Enter übernimmt den ersten Treffer, statt das Formular abzuschicken.
      event.preventDefault();
      if (visible[0]) choose(visible[0]);
    }
  }

  const sources: ('all' | IconSource)[] = ['all', 'di', 'sh', 'iconify'];
  const isImage = $derived(resolveIcon(value, name).kind === 'image');
</script>

<div class="flex items-center gap-2">
  <div class="relative flex-1">
    <input
      {id}
      class="input pr-9"
      placeholder="di:proxmox, sh:technitium, mdi:server oder https://…"
      bind:value
      autocomplete="off"
      spellcheck="false"
      aria-describedby="{id}-hint"
    />
    {#if value}
      <button
        type="button"
        class="icon-btn absolute top-1/2 right-1 -translate-y-1/2"
        aria-label="Icon entfernen"
        onclick={() => (value = '')}
      >
        <UiIcon name="x" size={14} />
      </button>
    {/if}
  </div>
  <button
    bind:this={toggle}
    type="button"
    class="btn shrink-0"
    aria-expanded={open}
    aria-controls="{id}-panel"
    onclick={() => (open ? hide() : show())}
  >
    <UiIcon name={open ? 'up' : 'search'} size={16} />
    {open ? 'Ausblenden' : 'Durchsuchen'}
  </button>
</div>
<p id="{id}-hint" class="field-hint">
  {#if value && !isImage}
    Unbekanntes Format, es werden Initialen angezeigt.
  {:else}
    Aus der Liste wählen oder selbst eintragen, zum Beispiel eine Bild-URL.
  {/if}
</p>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    id="{id}-panel"
    class="mt-2 rounded-xl border border-line bg-bg p-2"
    onkeydown={onPanelKeydown}
  >
    <div class="relative">
      <UiIcon
        name="search"
        size={16}
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
      />
      <input
        bind:this={searchInput}
        bind:value={query}
        type="search"
        class="input bg-elevated pl-9"
        placeholder="Icons durchsuchen …"
        aria-label="Icons durchsuchen"
        aria-controls="{id}-grid"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onSearchKeydown}
      />
    </div>

    <div class="mt-2 flex flex-wrap gap-1" role="group" aria-label="Quelle">
      {#each sources as item (item)}
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-xs font-medium transition"
          class:border-accent={source === item}
          class:text-accent={source === item}
          class:border-line={source !== item}
          class:text-fg-muted={source !== item}
          aria-pressed={source === item}
          onclick={() => (source = item)}
        >
          {item === 'all' ? 'Alle' : sourceLabels[item]}
        </button>
      {/each}
    </div>

    <p class="sr-only" aria-live="polite">
      {catalog ? `${options.length} Icons gefunden` : ''}
    </p>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={grid}
      id="{id}-grid"
      class="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1 overflow-y-auto overscroll-contain pr-1"
      role="group"
      aria-label="Icons"
      onkeydown={onGridKeydown}
    >
      {#each visible as option (option.value)}
        <button
          type="button"
          data-icon
          class="flex flex-col items-center gap-1 rounded-lg p-2 text-center transition hover:bg-muted focus-visible:bg-muted"
          class:ring-2={value === option.value}
          class:ring-accent={value === option.value}
          aria-pressed={value === option.value}
          title={option.value}
          onclick={() => choose(option)}
        >
          <ServiceIcon icon={option.value} name={option.label} size={32} />
          <span class="line-clamp-2 w-full text-[11px] leading-tight break-all text-fg-muted"
            >{option.label}</span
          >
        </button>
      {/each}
      <div bind:this={sentinel} class="col-span-full h-px" aria-hidden="true"></div>
    </div>

    <p class="mt-2 px-1 text-xs text-fg-muted">
      {#if loadError}
        <span class="text-down">{loadError}</span>
      {:else if !catalog && source !== 'iconify'}
        Lädt Icons …
      {:else if options.length === 0 && iconifyState === 'loading'}
        Sucht …
      {:else if options.length === 0}
        Keine Icons gefunden{query ? ` für „${query}“` : ''}.
      {:else}
        {options.length.toLocaleString('de-DE')} Icons{query ? ` für „${query}“` : ''}
        {#if iconifyState === 'error'}· Material & Simple Icons gerade nicht erreichbar{/if}
      {/if}
      {#if source === 'iconify' && query.trim().length < 2}
        Für Material & Simple Icons mindestens zwei Zeichen eingeben.
      {/if}
    </p>
  </div>
{/if}

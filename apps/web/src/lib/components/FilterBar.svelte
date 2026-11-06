<script lang="ts">
  import UiIcon from './UiIcon.svelte';

  export interface FilterGroup {
    key: string;
    label: string;
    options: { value: string; label: string; count?: number }[];
    selected: string[];
  }
  export interface ColumnOption {
    key: string;
    label: string;
    visible: boolean;
  }

  interface Props {
    query: string;
    placeholder: string;
    ariaLabel: string;
    groups?: FilterGroup[];
    columns?: ColumnOption[];
    shown: number;
    total: number;
    ontoggle?: (group: string, value: string) => void;
    ontogglecolumn?: (key: string) => void;
    onquery: (value: string) => void;
    onreset: () => void;
  }
  let {
    query,
    placeholder,
    ariaLabel,
    groups = [],
    columns = [],
    shown,
    total,
    ontoggle,
    ontogglecolumn,
    onquery,
    onreset,
  }: Props = $props();

  const active = $derived(query.trim() !== '' || groups.some((g) => g.selected.length > 0));
</script>

<div class="grid gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full sm:w-80">
      <UiIcon
        name="search"
        size={16}
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
      />
      <input
        class="input pl-9"
        type="search"
        {placeholder}
        aria-label={ariaLabel}
        value={query}
        oninput={(event) => onquery(event.currentTarget.value)}
      />
    </div>
    <span class="text-xs text-fg-muted tabular-nums" aria-live="polite">
      {shown === total ? `${total} Einträge` : `${shown} von ${total}`}
    </span>
    {#if active}
      <button type="button" class="text-xs text-accent hover:underline" onclick={onreset}>
        Zurücksetzen
      </button>
    {/if}
    {#if columns.length > 0}
      <details class="relative ml-auto">
        <summary class="btn cursor-pointer px-2.5 py-1 text-xs">Spalten</summary>
        <div
          class="absolute right-0 z-20 mt-1 grid min-w-40 gap-1 rounded-xl border border-line bg-elevated p-2 text-sm shadow-xl"
        >
          {#each columns as column (column.key)}
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={column.visible}
                onchange={() => ontogglecolumn?.(column.key)}
              />
              {column.label}
            </label>
          {/each}
        </div>
      </details>
    {/if}
  </div>
  {#if groups.length > 0}
    <div class="flex flex-wrap gap-x-4 gap-y-2">
      {#each groups as group (group.key)}
        <div class="flex flex-wrap items-center gap-1" role="group" aria-label={group.label}>
          <span class="mr-1 text-xs text-fg-muted">{group.label}</span>
          {#each group.options as option (option.value)}
            <button
              type="button"
              class="btn px-2.5 py-1 text-xs"
              class:bg-muted={group.selected.includes(option.value)}
              class:font-semibold={group.selected.includes(option.value)}
              aria-pressed={group.selected.includes(option.value)}
              onclick={() => ontoggle?.(group.key, option.value)}
            >
              {option.label}{option.count !== undefined ? ` (${option.count})` : ''}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</div>

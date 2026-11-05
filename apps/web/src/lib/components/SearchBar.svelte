<script lang="ts">
  import UiIcon from './UiIcon.svelte';

  interface Props {
    value: string;
    resultCount: number;
    onkeydown: (event: KeyboardEvent) => void;
    input?: HTMLInputElement;
  }

  let { value = $bindable(), resultCount, onkeydown, input = $bindable() }: Props = $props();
</script>

<div class="relative w-full max-w-xl" role="search">
  <UiIcon
    name="search"
    class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
  />
  <input
    bind:this={input}
    bind:value
    type="search"
    class="input h-11 rounded-xl bg-elevated pr-16 pl-10 text-base shadow-[var(--shadow)]"
    placeholder="Services durchsuchen …"
    aria-label="Services durchsuchen"
    aria-controls="search-results"
    autocomplete="off"
    spellcheck="false"
    {onkeydown}
  />
  <kbd
    class="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-muted sm:block"
    aria-hidden="true">/</kbd
  >
  <span class="sr-only" aria-live="polite">
    {value.trim() ? `${resultCount} Treffer` : ''}
  </span>
</div>

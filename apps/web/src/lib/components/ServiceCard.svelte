<script lang="ts">
  import type { Service, ServiceStatus } from '@ultimate-dash/shared';
  import { dragHandle } from 'svelte-dnd-action';
  import ServiceIcon from './ServiceIcon.svelte';
  import StatusDot from './StatusDot.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    service: Service;
    status: ServiceStatus | undefined;
    editMode?: boolean;
    active?: boolean;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    onedit?: () => void;
    ondelete?: () => void;
    onmove?: (direction: -1 | 1) => void;
  }

  let {
    service,
    status,
    editMode = false,
    active = false,
    canMoveUp = false,
    canMoveDown = false,
    onedit,
    ondelete,
    onmove,
  }: Props = $props();

  const host = $derived.by(() => {
    try {
      return new URL(service.url).host;
    } catch {
      return service.url;
    }
  });
</script>

<div
  class="group/card relative flex items-center gap-3 rounded-xl border bg-elevated p-3 shadow-[var(--shadow)] transition
    duration-150 hover:-translate-y-0.5 hover:border-accent/50 focus-within:border-accent/60"
  class:border-line={!active}
  class:border-accent={active}
  class:ring-2={active}
  class:ring-accent={active}
>
  {#if editMode}
    <span
      use:dragHandle
      class="relative z-10 -mr-1 -ml-1 grid h-9 w-5 shrink-0 cursor-grab place-items-center rounded text-fg-muted hover:text-fg active:cursor-grabbing"
      aria-label="{service.name} verschieben"
    >
      <UiIcon name="grip" size={16} />
    </span>
  {/if}
  <ServiceIcon icon={service.icon} name={service.name} />
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      {#if editMode}
        <span class="truncate font-medium">{service.name}</span>
      {:else}
        <a
          href={service.url}
          target={service.target}
          rel={service.target === '_blank' ? 'noopener noreferrer' : undefined}
          class="truncate font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          data-service-link={service.id}
        >
          {service.name}
        </a>
      {/if}
      {#if service.statusCheck}
        <span class="ml-auto shrink-0"><StatusDot {status} /></span>
      {/if}
    </div>
    <p class="truncate text-sm text-fg-muted">{service.description ?? host}</p>
    {#if service.tags.length > 0}
      <ul class="mt-1.5 flex flex-wrap gap-1" aria-label="Tags">
        {#each service.tags as tag (tag)}
          <li class="rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-none text-fg-muted">
            {tag}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if editMode}
    <div class="relative z-10 flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        class="icon-btn"
        disabled={!canMoveUp}
        onclick={() => onmove?.(-1)}
        aria-label="{service.name} nach oben"
      >
        <UiIcon name="up" size={16} />
      </button>
      <button
        type="button"
        class="icon-btn"
        disabled={!canMoveDown}
        onclick={() => onmove?.(1)}
        aria-label="{service.name} nach unten"
      >
        <UiIcon name="down" size={16} />
      </button>
      <button
        type="button"
        class="icon-btn"
        onclick={onedit}
        aria-label="{service.name} bearbeiten"
      >
        <UiIcon name="pencil" size={16} />
      </button>
      <button
        type="button"
        class="icon-btn hover:text-down"
        onclick={ondelete}
        aria-label="{service.name} löschen"
      >
        <UiIcon name="trash" size={16} />
      </button>
    </div>
  {/if}
</div>

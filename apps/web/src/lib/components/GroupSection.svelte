<script lang="ts">
  import type { DashboardGroup, Service, ServiceStatus } from '@ultimate-dash/shared';
  import ServiceCard from './ServiceCard.svelte';
  import ServiceIcon from './ServiceIcon.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    group: DashboardGroup;
    statuses: Record<number, ServiceStatus>;
    editMode: boolean;
    isFirst: boolean;
    isLast: boolean;
    onaddservice: () => void;
    oneditgroup: () => void;
    ondeletegroup: () => void;
    onmovegroup: (direction: -1 | 1) => void;
    oneditservice: (service: Service) => void;
    ondeleteservice: (service: Service) => void;
    onmoveservice: (service: Service, direction: -1 | 1) => void;
  }

  let props: Props = $props();
  const group = $derived(props.group);

  // Eingeklappt-Zustand ist eine Ansichtseinstellung pro Browser.
  const storageKey = $derived(`ud-collapsed-${group.id}`);
  let collapsed = $state(false);
  $effect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      collapsed = saved === null ? group.collapsed : saved === '1';
    } catch {
      collapsed = group.collapsed;
    }
  });

  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(storageKey, collapsed ? '1' : '0');
    } catch {
      // ignorieren
    }
  }

  const upCount = $derived(
    group.services.filter((s) => props.statuses[s.id]?.state === 'up').length,
  );
  const checkedCount = $derived(group.services.filter((s) => s.statusCheck).length);
  const contentId = $derived(`group-${group.id}-content`);
</script>

<section aria-labelledby="group-{group.id}-title" class="flex flex-col gap-3">
  <header class="flex items-center gap-2">
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left"
      aria-expanded={!collapsed}
      aria-controls={contentId}
      onclick={toggle}
    >
      <UiIcon
        name="chevron"
        size={16}
        class="shrink-0 text-fg-muted transition-transform {collapsed ? '-rotate-90' : ''}"
      />
      {#if group.icon}<ServiceIcon icon={group.icon} name={group.name} size={20} />{/if}
      <h2
        id="group-{group.id}-title"
        class="truncate text-sm font-semibold tracking-wide text-fg-muted uppercase"
      >
        {group.name}
      </h2>
      {#if checkedCount > 0}
        <span
          class="text-xs text-fg-muted tabular-nums"
          title="{upCount} von {checkedCount} online"
        >
          {upCount}/{checkedCount}
        </span>
      {/if}
    </button>
    {#if props.editMode}
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="icon-btn"
          disabled={props.isFirst}
          onclick={() => props.onmovegroup(-1)}
          aria-label="Gruppe {group.name} nach oben"
        >
          <UiIcon name="up" size={16} />
        </button>
        <button
          type="button"
          class="icon-btn"
          disabled={props.isLast}
          onclick={() => props.onmovegroup(1)}
          aria-label="Gruppe {group.name} nach unten"
        >
          <UiIcon name="down" size={16} />
        </button>
        <button
          type="button"
          class="icon-btn"
          onclick={props.oneditgroup}
          aria-label="Gruppe {group.name} bearbeiten"
        >
          <UiIcon name="pencil" size={16} />
        </button>
        <button
          type="button"
          class="icon-btn hover:text-down"
          onclick={props.ondeletegroup}
          aria-label="Gruppe {group.name} löschen"
        >
          <UiIcon name="trash" size={16} />
        </button>
      </div>
    {/if}
  </header>

  {#if !collapsed}
    <div id={contentId} class="grid gap-2">
      {#each group.services as service, index (service.id)}
        <ServiceCard
          {service}
          status={props.statuses[service.id]}
          editMode={props.editMode}
          canMoveUp={index > 0}
          canMoveDown={index < group.services.length - 1}
          onedit={() => props.oneditservice(service)}
          ondelete={() => props.ondeleteservice(service)}
          onmove={(direction) => props.onmoveservice(service, direction)}
        />
      {:else}
        <p
          class="rounded-xl border border-dashed border-line p-4 text-center text-sm text-fg-muted"
        >
          Noch keine Services in dieser Gruppe.
        </p>
      {/each}
      {#if props.editMode}
        <button type="button" class="btn border-dashed" onclick={props.onaddservice}>
          <UiIcon name="plus" size={16} /> Service hinzufügen
        </button>
      {/if}
    </div>
  {/if}
</section>

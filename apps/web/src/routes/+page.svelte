<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    DashboardGroup,
    Group,
    GroupInput,
    Service,
    ServiceInput,
  } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { dashboard } from '$lib/dashboard.svelte';
  import { FLIP_MS, idsOf } from '$lib/dnd';
  import { dragHandleZone, type DndEvent } from 'svelte-dnd-action';
  import { searchServices } from '$lib/search';
  import { theme } from '$lib/theme.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import GroupForm from '$lib/components/GroupForm.svelte';
  import GroupSection from '$lib/components/GroupSection.svelte';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import ServiceCard from '$lib/components/ServiceCard.svelte';
  import ServiceForm from '$lib/components/ServiceForm.svelte';
  import UiIcon from '$lib/components/UiIcon.svelte';
  import SettingsMenu from '$lib/components/SettingsMenu.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import NetMenu from '$lib/components/NetMenu.svelte';
  import DnsPanel from '$lib/components/DnsPanel.svelte';
  import ProxmoxPanel from '$lib/components/ProxmoxPanel.svelte';
  import FeedPanel from '$lib/components/FeedPanel.svelte';
  import { news } from '$lib/feeds.svelte';
  import { menus } from '$lib/menus.svelte';

  let query = $state('');
  let activeIndex = $state(0);
  let searchInput: HTMLInputElement | undefined = $state();
  let editModeRequested = $state(false);
  // Jeder bearbeitet sein eigenes Dashboard (nur das IPAM/DNS/DHCP bleibt Admins vorbehalten).
  const editMode = $derived(editModeRequested);

  // Dialog-Zustände
  let serviceDialog = $state<{ open: boolean; service: Service | null; groupId: number | null }>({
    open: false,
    service: null,
    groupId: null,
  });
  let groupDialog = $state<{ open: boolean; group: Group | null }>({ open: false, group: null });
  let confirm = $state<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({
    open: false,
    title: '',
    message: '',
    action: async () => {},
  });

  const groups = $derived(dashboard.data?.groups ?? []);
  // Im Bearbeiten-Modus brauchen die Gruppen den Platz fürs Verschieben.
  const showNews = $derived(!news.prefs.hidden && !editMode);

  // Lokale Reihenfolge für Drag-and-drop der Gruppen
  let groupItems = $state.raw<DashboardGroup[]>([]);
  $effect(() => {
    groupItems = groups;
  });

  function onGroupsConsider(event: CustomEvent<DndEvent<DashboardGroup>>) {
    groupItems = event.detail.items;
  }

  function onGroupsFinalize(event: CustomEvent<DndEvent<DashboardGroup>>) {
    groupItems = event.detail.items;
    void run(() => api.reorderGroups(idsOf(groupItems)), 'Reihenfolge gespeichert').catch(
      () => undefined,
    );
  }
  const hits = $derived(searchServices(groups, query));
  const searching = $derived(query.trim().length > 0);

  $effect(() => {
    document.title = dashboard.data?.title ?? 'Ultimate Dash';
  });
  $effect(() => {
    void query;
    activeIndex = 0;
  });

  onMount(() => {
    void dashboard.load();
    dashboard.connect();
    void news.load();
    return () => dashboard.disconnect();
  });

  function openService(service: Service, newTab = false) {
    const target = newTab ? '_blank' : service.target;
    if (target === '_blank') window.open(service.url, '_blank', 'noopener,noreferrer');
    else window.location.href = service.url;
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, hits.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === 'Enter') {
      const hit = hits[activeIndex];
      if (hit) {
        event.preventDefault();
        openService(hit.service, event.ctrlKey || event.metaKey);
      }
    } else if (event.key === 'Escape') {
      query = '';
      searchInput?.blur();
    }
  }

  /** Einfach lostippen: Tastendruck außerhalb von Eingabefeldern startet die Suche. */
  function onGlobalKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"], dialog');
    if (typing || event.altKey) return;
    if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || event.key === '/') {
      event.preventDefault();
      searchInput?.focus();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && event.key.length === 1 && /\S/.test(event.key)) {
      searchInput?.focus();
      // Das Zeichen landet durch den Fokuswechsel automatisch im Feld.
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toasts.show(success);
      await dashboard.load();
    } catch (error) {
      // Feldfehler zeigt das Formular selbst an.
      if (!(error instanceof ApiError && error.issues.length > 0)) {
        toasts.show(error instanceof Error ? error.message : 'Aktion fehlgeschlagen', 'error');
      }
      throw error;
    }
  }

  async function saveService(input: ServiceInput) {
    const current = serviceDialog.service;
    await run(
      () => (current ? api.updateService(current.id, input) : api.createService(input)),
      current ? 'Service gespeichert' : 'Service hinzugefügt',
    );
    serviceDialog.open = false;
  }

  async function saveGroup(input: GroupInput) {
    const current = groupDialog.group;
    await run(
      () => (current ? api.updateGroup(current.id, input) : api.createGroup(input)),
      current ? 'Gruppe gespeichert' : 'Gruppe angelegt',
    );
    groupDialog.open = false;
  }

  function askDelete(title: string, message: string, action: () => Promise<void>) {
    confirm = {
      open: true,
      title,
      message,
      action: async () => {
        await run(action, 'Gelöscht').catch(() => undefined);
        confirm.open = false;
      },
    };
  }

  function moveItem<T extends { id: number }>(items: T[], id: number, direction: -1 | 1): number[] {
    const ids = items.map((item) => item.id);
    const index = ids.indexOf(id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ids.length) return ids;
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
    return ids;
  }
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="page gap-6 sm:gap-8">
  <header class="flex flex-wrap items-center gap-3">
    <div class="flex min-w-0 items-center gap-2.5">
      <NetMenu />
      <img src="/favicon.svg" alt="" width="32" height="32" class="size-7 sm:size-8" />
      <h1 class="truncate text-lg font-semibold tracking-tight sm:text-xl">
        {dashboard.data?.title ?? 'Ultimate Dash'}
      </h1>
    </div>

    <div class="order-last flex w-full justify-center sm:order-none sm:flex-1">
      <SearchBar
        bind:value={query}
        bind:input={searchInput}
        resultCount={hits.length}
        onkeydown={onSearchKeydown}
      />
    </div>

    <div class="ml-auto flex items-center gap-1 sm:ml-0">
      <span
        class="mr-1 size-2 rounded-full"
        class:bg-up={dashboard.connection === 'live'}
        class:bg-unknown={dashboard.connection === 'connecting'}
        class:bg-down={dashboard.connection === 'offline'}
        title={dashboard.connection === 'live'
          ? 'Live-Verbindung aktiv'
          : dashboard.connection === 'connecting'
            ? 'Verbinde …'
            : 'Keine Verbindung zum Server'}
      ></span>
      <button
        type="button"
        class="icon-btn"
        onclick={() => theme.toggle()}
        aria-label={theme.current === 'dark' ? 'Helles Design' : 'Dunkles Design'}
      >
        <UiIcon name={theme.current === 'dark' ? 'sun' : 'moon'} />
      </button>
      <SettingsMenu />
      <UserMenu />
      <button
        type="button"
        class="btn ml-1"
        class:btn-primary={editMode}
        aria-pressed={editMode}
        aria-label={editMode ? 'Fertig' : 'Bearbeiten'}
        onclick={() => (editModeRequested = !editModeRequested)}
      >
        <UiIcon name={editMode ? 'check' : 'pencil'} size={16} />
        <span class="hidden sm:inline">{editMode ? 'Fertig' : 'Bearbeiten'}</span>
      </button>
    </div>
  </header>

  <div class="flex min-w-0 flex-1 items-start gap-6 xl:gap-8">
    <main class="grid min-w-0 flex-1 content-start gap-6 sm:gap-8">
      {#if dashboard.data && !searching}
        <DnsPanel onconnect={() => (menus.technitiumOpen = true)} />
        {#if auth.isAdmin}
          <ProxmoxPanel onconnect={() => (menus.proxmoxOpen = true)} />
        {/if}
      {/if}
      {#if dashboard.error && !dashboard.data}
        <div
          class="mx-auto max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
          role="alert"
        >
          <p class="font-medium">Das Dashboard konnte nicht geladen werden.</p>
          <p class="mt-1 text-sm text-fg-muted">{dashboard.error}</p>
          <button type="button" class="btn mt-4" onclick={() => dashboard.load()}
            >Erneut versuchen</button
          >
        </div>
      {:else if !dashboard.data}
        <div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Lädt">
          {#each Array(4) as _, i (i)}
            <div class="grid gap-2">
              <div class="h-4 w-32 animate-pulse rounded bg-muted"></div>
              {#each Array(3) as __, j (j)}
                <div class="h-16 animate-pulse rounded-xl bg-muted"></div>
              {/each}
            </div>
          {/each}
        </div>
      {:else if searching}
        <section
          id="search-results"
          aria-label="Suchergebnisse"
          class="mx-auto grid max-w-xl gap-2"
        >
          {#each hits as hit, index (hit.service.id)}
            <div>
              <p class="mb-1 text-[11px] tracking-wide text-fg-muted uppercase">{hit.groupName}</p>
              <ServiceCard
                service={hit.service}
                status={dashboard.statuses[hit.service.id]}
                active={index === activeIndex}
              />
            </div>
          {:else}
            <p class="py-10 text-center text-fg-muted">Keine Services gefunden für „{query}“.</p>
          {/each}
          {#if hits.length > 0}
            <p class="mt-2 text-center text-xs text-fg-muted">
              <kbd>↑</kbd> <kbd>↓</kbd> auswählen · <kbd>Enter</kbd> öffnen · <kbd>Strg</kbd>+<kbd
                >Enter</kbd
              >
              in neuem Tab ·
              <kbd>Esc</kbd> schließen
            </p>
          {/if}
        </section>
      {:else if groups.length === 0}
        <div class="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
          <span class="grid size-14 place-items-center rounded-2xl bg-muted text-accent"
            ><UiIcon name="layout" size={28} /></span
          >
          <h2 class="text-lg font-semibold">Willkommen bei Ultimate Dash</h2>
          <p class="text-fg-muted">
            Das ist dein eigenes Dashboard. Lege eine erste Gruppe an, zum Beispiel „Infrastruktur“,
            und füge dann deine Services hinzu, oder übernimm Einträge von einem anderen Benutzer.
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => {
                editModeRequested = true;
                groupDialog = { open: true, group: null };
              }}
            >
              <UiIcon name="plus" size={16} /> Erste Gruppe anlegen
            </button>
            <button type="button" class="btn" onclick={() => (menus.copyOpen = true)}>
              <UiIcon name="copy" size={16} /> Von anderem Benutzer kopieren
            </button>
          </div>
        </div>
      {:else}
        <div
          class="group-grid gap-y-6 sm:gap-y-8"
          aria-label="Gruppen"
          use:dragHandleZone={{
            items: groupItems,
            type: 'group',
            flipDurationMs: FLIP_MS,
            dragDisabled: !editMode,
            dropTargetStyle: {},
            delayTouchStart: true,
            useCursorForDetection: true,
          }}
          onconsider={onGroupsConsider}
          onfinalize={onGroupsFinalize}
        >
          {#each groupItems as group, index (group.id)}
            <GroupSection
              {group}
              statuses={dashboard.statuses}
              {editMode}
              isFirst={index === 0}
              isLast={index === groupItems.length - 1}
              onaddservice={() =>
                (serviceDialog = { open: true, service: null, groupId: group.id })}
              oneditgroup={() => (groupDialog = { open: true, group })}
              ondeletegroup={() =>
                askDelete(
                  'Gruppe löschen?',
                  group.services.length > 0
                    ? `„${group.name}“ und ihre ${group.services.length} Services werden gelöscht.`
                    : `„${group.name}“ wird gelöscht.`,
                  () => api.deleteGroup(group.id),
                )}
              onmovegroup={(direction) =>
                void run(
                  () => api.reorderGroups(moveItem(groups, group.id, direction)),
                  'Reihenfolge gespeichert',
                ).catch(() => undefined)}
              oneditservice={(service) =>
                (serviceDialog = { open: true, service, groupId: service.groupId })}
              ondeleteservice={(service) =>
                askDelete('Service löschen?', `„${service.name}“ wird gelöscht.`, () =>
                  api.deleteService(service.id),
                )}
              onmoveservice={(service, direction) =>
                void run(
                  () =>
                    api.arrangeServices(group.id, moveItem(group.services, service.id, direction)),
                  'Reihenfolge gespeichert',
                ).catch(() => undefined)}
              onarrangeservices={(ids) =>
                void run(() => api.arrangeServices(group.id, ids), 'Reihenfolge gespeichert').catch(
                  () => undefined,
                )}
            />
          {/each}
        </div>
        {#if editMode}
          <div class="group-grid mt-8">
            <button
              type="button"
              class="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-fg-muted transition hover:border-accent hover:text-accent"
              onclick={() => (groupDialog = { open: true, group: null })}
            >
              <UiIcon name="plus" size={22} /> Gruppe hinzufügen
            </button>
          </div>
        {/if}
      {/if}
      {#if showNews && dashboard.data && !searching}
        <div class="xl:hidden"><FeedPanel variant="section" /></div>
      {/if}
    </main>
    {#if showNews}
      <aside class="hidden shrink-0 self-stretch xl:block" aria-label="Neuigkeiten">
        <FeedPanel variant="sidebar" />
      </aside>
    {/if}
  </div>
</div>

<ServiceForm
  open={serviceDialog.open}
  {groups}
  service={serviceDialog.service}
  defaultGroupId={serviceDialog.groupId}
  onclose={() => (serviceDialog.open = false)}
  onsubmit={saveService}
/>
<GroupForm
  open={groupDialog.open}
  group={groupDialog.group}
  onclose={() => (groupDialog.open = false)}
  onsubmit={saveGroup}
/>
<ConfirmDialog
  open={confirm.open}
  title={confirm.title}
  message={confirm.message}
  onclose={() => (confirm.open = false)}
  onconfirm={confirm.action}
/>

<script lang="ts">
  import type { CopySummary, DashboardSource } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { dashboard } from '$lib/dashboard.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let sources = $state<DashboardSource[] | null>(null);
  let sourceId = $state<number | null>(null);
  /** Ausgewählte Service-IDs; Gruppen ohne Services werden über `pickedGroups` geführt. */
  let pickedServices = $state<Set<number>>(new Set());
  let pickedGroups = $state<Set<number>>(new Set());
  let error = $state('');
  let loading = $state(false);
  let saving = $state(false);

  const source = $derived(sources?.find((s) => s.userId === sourceId) ?? null);
  const selectedCount = $derived(pickedServices.size);

  $effect(() => {
    if (!open) return;
    sources = null;
    sourceId = null;
    pickedServices = new Set();
    pickedGroups = new Set();
    error = '';
    loading = true;
    api
      .dashboardSources()
      .then((list) => {
        sources = list;
        if (list.length > 0) sourceId = list[0]!.userId;
      })
      .catch((e) => (error = e instanceof Error ? e.message : 'Laden fehlgeschlagen'))
      .finally(() => (loading = false));
  });

  function chooseSource(id: number) {
    sourceId = id;
    pickedServices = new Set();
    pickedGroups = new Set();
  }

  function groupState(group: DashboardSource['groups'][number]): 'all' | 'some' | 'none' {
    if (group.services.length === 0) return pickedGroups.has(group.id) ? 'all' : 'none';
    const n = group.services.filter((s) => pickedServices.has(s.id)).length;
    return n === 0 ? 'none' : n === group.services.length ? 'all' : 'some';
  }

  function toggleGroup(group: DashboardSource['groups'][number]) {
    const next = new Set(pickedServices);
    const nextGroups = new Set(pickedGroups);
    const select = groupState(group) !== 'all';
    if (group.services.length === 0) {
      if (select) nextGroups.add(group.id);
      else nextGroups.delete(group.id);
    }
    for (const s of group.services) {
      if (select) next.add(s.id);
      else next.delete(s.id);
    }
    pickedServices = next;
    pickedGroups = nextGroups;
  }

  function toggleService(id: number) {
    const next = new Set(pickedServices);
    if (!next.delete(id)) next.add(id);
    pickedServices = next;
  }

  function toggleAll() {
    if (!source) return;
    const all = source.groups.every((g) => groupState(g) === 'all');
    const next = new Set<number>();
    const nextGroups = new Set<number>();
    if (!all) {
      for (const g of source.groups) {
        if (g.services.length === 0) nextGroups.add(g.id);
        for (const s of g.services) next.add(s.id);
      }
    }
    pickedServices = next;
    pickedGroups = nextGroups;
  }

  /** Teilzustand der Gruppen-Checkbox (indeterminate lässt sich nur per Eigenschaft setzen). */
  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return {
      update(next: boolean) {
        node.indeterminate = next;
      },
    };
  }

  function summaryText(r: CopySummary): string {
    const parts = [`${r.servicesCreated} ${r.servicesCreated === 1 ? 'Service' : 'Services'}`];
    if (r.groupsCreated > 0)
      parts.push(`${r.groupsCreated} ${r.groupsCreated === 1 ? 'neue Gruppe' : 'neue Gruppen'}`);
    if (r.servicesSkipped > 0) parts.push(`${r.servicesSkipped} schon vorhanden`);
    return `Kopiert: ${parts.join(', ')}`;
  }

  async function submit() {
    if (!source) return;
    saving = true;
    error = '';
    try {
      const groups = source.groups
        .map((g) => ({
          groupId: g.id,
          serviceIds: g.services.filter((s) => pickedServices.has(s.id)).map((s) => s.id),
        }))
        .filter((g) => g.serviceIds.length > 0 || pickedGroups.has(g.groupId));
      const result = await api.copyDashboard({ sourceUserId: source.userId, groups });
      toasts.show(summaryText(result));
      await dashboard.load();
      onclose();
    } catch (e) {
      error = e instanceof ApiError || e instanceof Error ? e.message : 'Kopieren fehlgeschlagen';
    } finally {
      saving = false;
    }
  }

  const canSubmit = $derived(selectedCount > 0 || pickedGroups.size > 0);
</script>

<Dialog {open} {onclose} title="Von anderem Benutzer kopieren">
  <div class="grid gap-4">
    {#if loading}
      <p class="text-sm text-fg-muted">Lädt …</p>
    {:else if sources && sources.length === 0}
      <p class="text-sm text-fg-muted">
        Kein anderer Benutzer hat bisher Gruppen oder Services eingetragen.
      </p>
    {:else if sources}
      <p class="text-sm text-fg-muted">
        Wähle, was du in dein Dashboard übernehmen möchtest. Du bekommst eine unabhängige Kopie;
        Gruppen gleichen Namens werden ergänzt, schon vorhandene Services übersprungen.
      </p>
      <label class="grid gap-1 text-sm">
        <span class="font-medium">Dashboard von</span>
        <select
          class="field"
          value={sourceId}
          onchange={(e) => chooseSource(Number(e.currentTarget.value))}
        >
          {#each sources as s (s.userId)}
            <option value={s.userId}>{s.username}</option>
          {/each}
        </select>
      </label>
      {#if source}
        <div class="flex items-center justify-between text-sm">
          <button type="button" class="text-accent hover:underline" onclick={toggleAll}>
            {source.groups.every((g) => groupState(g) === 'all')
              ? 'Auswahl aufheben'
              : 'Alles auswählen'}
          </button>
          <span class="text-fg-muted"
            >{selectedCount} {selectedCount === 1 ? 'Service' : 'Services'} ausgewählt</span
          >
        </div>
        <ul class="grid max-h-80 gap-3 overflow-y-auto rounded-xl border border-line p-3">
          {#each source.groups as group (group.id)}
            {@const state = groupState(group)}
            <li>
              <label class="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={state === 'all'}
                  use:indeterminate={state === 'some'}
                  onchange={() => toggleGroup(group)}
                />
                {group.name}
                <span class="text-xs font-normal text-fg-muted">({group.services.length})</span>
              </label>
              {#if group.services.length > 0}
                <ul class="mt-1 grid gap-1 pl-6">
                  {#each group.services as service (service.id)}
                    <li>
                      <label class="flex items-baseline gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={pickedServices.has(service.id)}
                          onchange={() => toggleService(service.id)}
                        />
                        <span>{service.name}</span>
                        <span class="truncate text-xs text-fg-muted">{service.url}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if error}
      <p class="text-sm text-down" role="alert">{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button
      type="button"
      class="btn btn-primary"
      disabled={!canSubmit || saving || !source}
      onclick={submit}
    >
      {saving ? 'Kopiert …' : 'Kopieren'}
    </button>
  {/snippet}
</Dialog>

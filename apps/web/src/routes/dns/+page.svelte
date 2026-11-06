<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { DnsRecord, DnsRecordList, DnsZone, IpamReachability } from '@ultimate-dash/shared';
  import { ipv4ToInt, parseCidr } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { relativeName, type RecordFormValues } from '$lib/dns-records';
  import {
    compareText,
    formatSort,
    matchesAll,
    nextSort,
    parseSort,
    splitList,
    toggleIn,
    tokensOf,
    type SortState,
  } from '$lib/list-filter';
  import { theme } from '$lib/theme.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import FilterBar, { type FilterGroup } from '$lib/components/FilterBar.svelte';
  import SavedViews from '$lib/components/SavedViews.svelte';
  import ReachDot from '$lib/components/ReachDot.svelte';
  import RecordForm from '$lib/components/RecordForm.svelte';
  import TechNav from '$lib/components/TechNav.svelte';
  import UiIcon from '$lib/components/UiIcon.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';

  let zones = $state<DnsZone[]>([]);
  let zonesError = $state<string | null>(null);
  let notConfigured = $state(false);
  let list = $state<DnsRecordList | null>(null);
  let recordsError = $state<string | null>(null);
  let loadingRecords = $state(false);
  let zoneFilter = $state('');

  let form = $state<{ open: boolean; record: DnsRecord | null }>({ open: false, record: null });
  let confirm = $state<{ open: boolean; record: DnsRecord | null }>({ open: false, record: null });

  const selected = $derived(page.url.searchParams.get('zone'));
  const visibleZones = $derived(
    zones.filter((z) => z.name.toLowerCase().includes(zoneFilter.trim().toLowerCase())),
  );
  const records = $derived(list?.records ?? []);

  // ---- Suche, Filter und Sortierung; Zustand in der URL ----
  const SORT_KEYS = ['name', 'type', 'value', 'ttl'];
  const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };
  const VIEW_KEYS = ['q', 'type', 'state', 'sort'] as const;
  const params = $derived(page.url.searchParams);
  const urlQuery = $derived(params.get('q') ?? '');
  const typeSel = $derived(splitList(params.get('type')));
  const stateSel = $derived(splitList(params.get('state')));
  const sort = $derived(parseSort(params.get('sort'), SORT_KEYS, DEFAULT_SORT));

  function setParams(changes: Record<string, string | null>) {
    const url = new URL(page.url);
    for (const [key, value] of Object.entries(changes)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    void goto(url, { keepFocus: true, noScroll: true, replaceState: true });
  }

  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let typed = $state<string | null>(null);
  const shownQuery = $derived(typed ?? urlQuery);
  function onquery(value: string) {
    typed = value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      setParams({ q: value.trim() || null });
      typed = null;
    }, 200);
  }
  const listParam = (key: string, current: string[], value: string) => {
    const next = toggleIn(current, value);
    setParams({ [key]: next.length > 0 ? next.join(',') : null });
  };
  const ontoggle = (group: string, value: string) =>
    group === 'type' ? listParam('type', typeSel, value) : listParam('state', stateSel, value);
  const reset = () => {
    typed = null;
    setParams({ q: null, type: null, state: null });
  };
  const sortBy = (key: string) => {
    const next = nextSort(sort, key);
    setParams({ sort: formatSort(next) === formatSort(DEFAULT_SORT) ? null : formatSort(next) });
  };
  const applyView = (saved: Record<string, string>) => {
    typed = null;
    setParams(Object.fromEntries(VIEW_KEYS.map((key) => [key, saved[key] ?? null])));
  };

  const stateOf = (r: DnsRecord) => (r.disabled ? 'disabled' : 'active');
  const groups = $derived<FilterGroup[]>([
    {
      key: 'type',
      label: 'Typ',
      selected: typeSel,
      options: [...new Set(records.map((r) => r.type))].sort().map((type) => ({
        value: type,
        label: type,
        count: records.filter((r) => r.type === type).length,
      })),
    },
    {
      key: 'state',
      label: 'Status',
      selected: stateSel,
      options: [
        { value: 'active', label: 'Aktiv' },
        { value: 'disabled', label: 'Deaktiviert' },
      ],
    },
  ]);

  const sortValue = (r: DnsRecord, key: string): string | number => {
    switch (key) {
      case 'type':
        return r.type;
      case 'value':
        return r.display;
      case 'ttl':
        return r.ttl;
      default:
        return r.domain;
    }
  };
  const rows = $derived.by(() => {
    const tokens = tokensOf(urlQuery);
    const factor = sort.dir === 'asc' ? 1 : -1;
    return records
      .filter(
        (r) =>
          (typeSel.length === 0 || typeSel.includes(r.type)) &&
          (stateSel.length === 0 || stateSel.includes(stateOf(r))) &&
          matchesAll(
            [
              r.domain,
              r.type,
              r.display,
              r.comments ?? '',
              String(r.ttl),
              r.disabled ? 'deaktiviert' : '',
            ]
              .join(' ')
              .toLocaleLowerCase('de'),
            tokens,
          ),
      )
      .sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        const by =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : compareText(String(x), String(y));
        return factor * by || compareText(a.domain, b.domain) || compareText(a.type, b.type);
      });
  });

  function selectZone(name: string) {
    void goto(`/dns?zone=${encodeURIComponent(name)}`, { replaceState: true, keepFocus: true });
  }

  async function loadZones() {
    try {
      zones = await api.dnsZones();
      zonesError = null;
      notConfigured = false;
      // Ohne Auswahl die erste eigene Zone öffnen.
      if (!selected && zones.length > 0)
        selectZone((zones.find((z) => !z.internal) ?? zones[0]!).name);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not-configured') notConfigured = true;
      else
        zonesError = error instanceof Error ? error.message : 'Zonen konnten nicht geladen werden';
    }
  }

  let requestId = 0;
  async function loadRecords(zone: string) {
    const id = ++requestId;
    loadingRecords = true;
    try {
      const result = await api.dnsRecords(zone);
      if (id !== requestId) return;
      list = result;
      recordsError = null;
    } catch (error) {
      if (id !== requestId) return;
      list = null;
      recordsError =
        error instanceof Error ? error.message : 'Records konnten nicht geladen werden';
    } finally {
      if (id === requestId) loadingRecords = false;
    }
  }

  $effect(() => {
    if (selected) {
      void loadRecords(selected);
    }
  });
  onMount(() => {
    void loadZones();
    // Erreichbarkeit aus dem IPAM; fehlt sie, zeigt die Tabelle einfach keinen Punkt.
    void api
      .ipamReachability()
      .then((r) => (reach = r))
      .catch(() => {});
  });

  let reach = $state<IpamReachability | null>(null);

  /** Antwort auf Ping für die Adresse eines A-Eintrags; null, wenn sie in keinem geprüften Netz liegt. */
  function aliveFor(record: DnsRecord): { alive: boolean; lastSeen: string | null } | null {
    if (!reach || record.data?.type !== 'A') return null;
    const host = reach.hosts[record.data.ipAddress];
    if (host) return host;
    const n = ipv4ToInt(record.data.ipAddress);
    const inScanned =
      n !== null &&
      reach.scanned.some((cidr) => {
        const c = parseCidr(cidr);
        return !!c && n > c.first && n < c.last;
      });
    return inScanned ? { alive: false, lastSeen: null } : null;
  }

  async function save(values: RecordFormValues) {
    const current = form.record;
    const input = { zone: selected!, ...values };
    if (current?.data) {
      await api.updateDnsRecord({
        ...input,
        current: { domain: current.domain, data: current.data },
      });
    } else {
      await api.addDnsRecord(input);
    }
    toasts.show(current ? 'Eintrag gespeichert' : 'Eintrag angelegt');
    form.open = false;
    await loadRecords(selected!);
  }

  async function remove(record: DnsRecord) {
    try {
      await api.deleteDnsRecord({ zone: selected!, domain: record.domain, data: record.data! });
      toasts.show('Eintrag gelöscht');
      await loadRecords(selected!);
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : 'Löschen fehlgeschlagen', 'error');
    } finally {
      confirm.open = false;
    }
  }
</script>

{#snippet th(key: string, label: string, cls: string)}
  <th
    class="{cls} font-medium"
    aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
  >
    <button type="button" class="inline-flex items-center gap-1" onclick={() => sortBy(key)}>
      {label}
      {#if sort.key === key}<UiIcon name={sort.dir === 'asc' ? 'up' : 'down'} size={12} />{/if}
    </button>
  </th>
{/snippet}

<div class="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
  <header class="flex flex-wrap items-center gap-3">
    <a href="/" class="icon-btn" aria-label="Zurück zum Dashboard"><UiIcon name="back" /></a>
    <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
      <UiIcon name="server" size={20} class="text-fg-muted" /> DNS-Zonen und Records
    </h1>
    <TechNav />
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="icon-btn"
        onclick={() => theme.toggle()}
        aria-label={theme.current === 'dark' ? 'Helles Design' : 'Dunkles Design'}
      >
        <UiIcon name={theme.current === 'dark' ? 'sun' : 'moon'} />
      </button>
      <UserMenu />
    </div>
  </header>

  {#if notConfigured}
    <div class="mx-auto max-w-md rounded-2xl border border-dashed border-line p-6 text-center">
      <p class="font-medium">Technitium ist noch nicht verbunden.</p>
      <p class="mt-1 text-sm text-fg-muted">
        {auth.isAdmin
          ? 'Richte die Verbindung im Benutzermenü unter „Technitium DNS“ ein.'
          : 'Ein Administrator kann die Verbindung einrichten.'}
      </p>
    </div>
  {:else if zonesError}
    <div
      class="mx-auto max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
      role="alert"
    >
      <p class="font-medium">Die Zonen konnten nicht geladen werden.</p>
      <p class="mt-1 text-sm text-fg-muted">{zonesError}</p>
      <button type="button" class="btn mt-4" onclick={loadZones}>Erneut versuchen</button>
    </div>
  {:else}
    <div class="grid flex-1 items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <!-- Zonen -->
      <nav aria-label="Zonen" class="grid gap-2 rounded-2xl border border-line bg-elevated p-3">
        <label class="sr-only" for="zone-filter">Zonen filtern</label>
        <input
          id="zone-filter"
          class="input py-1.5"
          type="search"
          placeholder="Zone suchen …"
          bind:value={zoneFilter}
        />
        <ul class="grid max-h-[60dvh] gap-0.5 overflow-y-auto">
          {#each visibleZones as zone (zone.name)}
            <li>
              <a
                href="/dns?zone={encodeURIComponent(zone.name)}"
                class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
                class:bg-muted={zone.name === selected}
                class:font-medium={zone.name === selected}
                class:text-fg-muted={zone.internal || zone.disabled}
                aria-current={zone.name === selected ? 'page' : undefined}
              >
                <span class="min-w-0 flex-1 truncate" title={zone.name}
                  >{zone.name || '(Root)'}</span
                >
                {#if zone.internal}<span class="text-[10px] tracking-wide uppercase">intern</span
                  >{/if}
                {#if zone.disabled}<span class="text-[10px] tracking-wide uppercase">aus</span>{/if}
              </a>
            </li>
          {:else}
            <li class="px-2 py-4 text-center text-sm text-fg-muted">
              {zones.length === 0 ? 'Keine Zonen vorhanden.' : 'Keine Zone gefunden.'}
            </li>
          {/each}
        </ul>
      </nav>

      <!-- Records -->
      <section aria-labelledby="records-title" class="grid min-w-0 gap-3">
        {#if selected}
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="records-title" class="mr-auto text-lg font-semibold">
              {selected}
              {#if list}<span class="text-sm font-normal text-fg-muted">
                  · {list.zone.type}{list.zone.dnssecStatus && list.zone.dnssecStatus !== 'Unsigned'
                    ? ' · DNSSEC'
                    : ''}</span
                >{/if}
            </h2>
            {#if auth.isAdmin && list && !list.zone.internal}
              <button
                type="button"
                class="btn btn-primary py-1.5"
                onclick={() => (form = { open: true, record: null })}
              >
                <UiIcon name="plus" size={16} /> Neuer Eintrag
              </button>
            {/if}
          </div>

          <FilterBar
            query={shownQuery}
            placeholder="Name, Wert, Kommentar …"
            ariaLabel="Records durchsuchen"
            {groups}
            shown={rows.length}
            total={records.length}
            {ontoggle}
            {onquery}
            onreset={reset}
          >
            {#snippet extra()}
              <SavedViews scope="dns" keys={VIEW_KEYS} onapply={applyView} />
            {/snippet}
          </FilterBar>

          {#if recordsError}
            <div class="rounded-2xl border border-down/40 bg-elevated p-5 text-sm" role="alert">
              <p class="font-medium">Die Records konnten nicht geladen werden.</p>
              <p class="mt-1 text-fg-muted">{recordsError}</p>
              <button type="button" class="btn mt-3" onclick={() => loadRecords(selected)}
                >Erneut versuchen</button
              >
            </div>
          {:else if !list}
            <div class="grid gap-2" aria-busy="true" aria-label="Lädt">
              {#each Array(5) as _, i (i)}<div
                  class="h-11 animate-pulse rounded-xl bg-muted"
                ></div>{/each}
            </div>
          {:else}
            <div
              class="relative overflow-x-auto rounded-2xl border border-line bg-elevated transition-opacity"
              class:opacity-60={loadingRecords}
            >
              <table class="w-full min-w-[34rem] text-left text-sm">
                <caption class="sr-only">Records der Zone {selected}</caption>
                <thead class="border-b border-line text-xs text-fg-muted">
                  <tr>
                    {@render th('name', 'Name', 'px-4 py-2')}
                    {@render th('type', 'Typ', 'px-2 py-2')}
                    {@render th('value', 'Wert', 'px-2 py-2')}
                    {@render th('ttl', 'TTL', 'px-2 py-2 text-right')}
                    <th class="w-20 px-2 py-2"><span class="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  {#each rows as record (record.domain + record.type + record.display)}
                    <tr class:opacity-50={record.disabled}>
                      <td class="px-4 py-2 font-mono text-[13px]" title={record.domain}>
                        {relativeName(record.domain, selected)}
                      </td>
                      <td class="px-2 py-2">
                        <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium"
                          >{record.type}</span
                        >
                      </td>
                      <td class="max-w-md px-2 py-2">
                        <span class="flex items-center gap-2">
                          <span class="block truncate font-mono text-[13px]" title={record.display}
                            >{record.display}</span
                          >
                          {#if aliveFor(record)}
                            {@const r = aliveFor(record)!}
                            <ReachDot alive={r.alive} lastSeen={r.lastSeen} />
                          {/if}
                        </span>
                        {#if record.comments || record.disabled}
                          <span class="block truncate text-xs text-fg-muted">
                            {record.disabled ? 'deaktiviert' : ''}{record.disabled &&
                            record.comments
                              ? ' · '
                              : ''}{record.comments ?? ''}
                          </span>
                        {/if}
                      </td>
                      <td class="px-2 py-2 text-right text-fg-muted tabular-nums">{record.ttl}</td>
                      <td class="px-2 py-1 text-right whitespace-nowrap">
                        {#if auth.isAdmin && record.data && !list.zone.internal}
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="{record.type} {record.domain} bearbeiten"
                            onclick={() => (form = { open: true, record })}
                          >
                            <UiIcon name="pencil" size={15} />
                          </button>
                          <button
                            type="button"
                            class="icon-btn hover:text-down"
                            aria-label="{record.type} {record.domain} löschen"
                            onclick={() => (confirm = { open: true, record })}
                          >
                            <UiIcon name="trash" size={15} />
                          </button>
                        {:else if auth.isAdmin && !record.data}
                          <span
                            class="text-[11px] text-fg-muted"
                            title="Dieser Typ wird nur angezeigt">nur Ansicht</span
                          >
                        {/if}
                      </td>
                    </tr>
                  {:else}
                    <tr>
                      <td colspan="5" class="px-4 py-10 text-center text-fg-muted">
                        {records.length === 0
                          ? 'Diese Zone hat noch keine Einträge.'
                          : 'Keine Einträge gefunden.'}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {:else}
          <p class="py-10 text-center text-fg-muted">Wähle links eine Zone.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if selected}
  <RecordForm
    open={form.open}
    zone={selected}
    record={form.record}
    onclose={() => (form.open = false)}
    onsubmit={save}
  />
  <ConfirmDialog
    open={confirm.open}
    title="Eintrag löschen?"
    message={confirm.record
      ? `${confirm.record.type} ${confirm.record.domain} → ${confirm.record.display} wird aus Technitium gelöscht.`
      : ''}
    onclose={() => (confirm.open = false)}
    onconfirm={() => remove(confirm.record!)}
  />
{/if}

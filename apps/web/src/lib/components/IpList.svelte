<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    ipv4ToInt,
    type IpamAddressUsage,
    type IpamCategory,
    type IpamRange,
  } from '@ultimate-dash/shared';
  import { auth } from '$lib/auth.svelte';
  import { categoryColor } from '$lib/ipam';
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
  import { vendors } from '$lib/vendors.svelte';
  import FilterBar, { type ColumnOption, type FilterGroup } from './FilterBar.svelte';
  import SavedViews from './SavedViews.svelte';
  import ReachDot from './ReachDot.svelte';
  import UiIcon from './UiIcon.svelte';

  interface Props {
    addresses: IpamAddressUsage[];
    ranges: IpamRange[];
    categories: IpamCategory[];
    selected: string | null;
    onopen: (address: string) => void;
    onhost: (row: IpamAddressUsage) => void;
    onforget: (row: IpamAddressUsage) => void;
  }
  let { addresses, ranges, categories, selected, onopen, onhost, onforget }: Props = $props();

  const typeLabel = { reservation: 'Reservierung', lease: 'Lease', static: 'Statisch' } as const;
  const sourceLabel = {
    lease: 'DHCP-Lease',
    reservation: 'DHCP-Reservierung',
    dns: 'DNS',
    discovered: 'Ping',
    manual: 'Von Hand',
  } as const;
  const statusLabel = { online: 'Online', offline: 'Offline', unchecked: 'Nicht geprüft' } as const;
  const flagLabel = { discovered: 'Entdeckt', conflict: 'Konflikt' } as const;

  const COLUMNS = [
    ['name', 'Name'],
    ['type', 'Typ'],
    ['status', 'Status'],
    ['source', 'Quelle'],
    ['mac', 'MAC'],
    ['vendor', 'Hersteller'],
    ['category', 'Kategorie'],
  ] as const;
  const SORT_KEYS = ['address', ...COLUMNS.map(([key]) => key)];
  const DEFAULT_SORT: SortState = { key: 'address', dir: 'asc' };

  // ---- Zustand in der URL (Links lassen sich teilen, Zurück-Taste funktioniert) ----
  const params = $derived(page.url.searchParams);
  const query = $derived(params.get('q') ?? '');
  const typeSel = $derived(splitList(params.get('type')));
  const statusSel = $derived(splitList(params.get('status')));
  const flagSel = $derived(splitList(params.get('flag')));
  const catSel = $derived(splitList(params.get('cat')));
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
  const shownQuery = $derived(typed ?? query);
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
  const ontoggle = (group: string, value: string) => {
    if (group === 'type') listParam('type', typeSel, value);
    else if (group === 'status') listParam('status', statusSel, value);
    else if (group === 'flag') listParam('flag', flagSel, value);
    else if (group === 'cat') listParam('cat', catSel, value);
  };
  const reset = () => {
    typed = null;
    setParams({ q: null, type: null, status: null, flag: null, cat: null });
  };
  const sortBy = (key: string) => {
    const next = nextSort(sort, key);
    setParams({ sort: formatSort(next) === formatSort(DEFAULT_SORT) ? null : formatSort(next) });
  };

  // ---- Sichtbare Spalten (pro Browser gemerkt) ----
  const STORAGE_KEY = 'ud.ipam.hidden-columns';
  let hidden = $state<string[]>([]);
  $effect(() => {
    try {
      hidden = splitList(localStorage.getItem(STORAGE_KEY));
    } catch {
      hidden = [];
    }
  });
  function toggleColumn(key: string) {
    hidden = toggleIn(hidden, key);
    try {
      localStorage.setItem(STORAGE_KEY, hidden.join(','));
    } catch {
      // ohne Speicher bleibt die Auswahl nur für diese Sitzung
    }
  }
  const visible = (key: string) => !hidden.includes(key);

  const VIEW_KEYS = ['q', 'type', 'status', 'flag', 'cat', 'sort'] as const;
  function applyView(params: Record<string, string>, hiddenColumns: string[]) {
    typed = null;
    setParams(Object.fromEntries(VIEW_KEYS.map((key) => [key, params[key] ?? null])));
    hidden = hiddenColumns;
    try {
      localStorage.setItem(STORAGE_KEY, hidden.join(','));
    } catch {
      // ohne Speicher bleibt die Auswahl nur für diese Sitzung
    }
  }

  // ---- Zeilen aufbereiten ----
  const rangeOf = (address: string): IpamRange | undefined => {
    const n = ipv4ToInt(address)!;
    return ranges.find((r) => n >= ipv4ToInt(r.startAddress)! && n <= ipv4ToInt(r.endAddress)!);
  };

  $effect(() => {
    void vendors.ensure(addresses.flatMap((a) => a.claims.map((c) => c.mac)));
  });

  const entries = $derived(
    addresses.map((row) => {
      const names = [...new Set(row.claims.map((c) => c.name).filter((n): n is string => !!n))];
      const macs = [...new Set(row.claims.map((c) => c.mac).filter((m): m is string => !!m))];
      const vendorNames = [...new Set(macs.map((m) => vendors.label(m)).filter(Boolean))];
      const category = categories.find((c) => c.id === rangeOf(row.address)?.categoryId) ?? null;
      const status = row.alive === null ? 'unchecked' : row.alive ? 'online' : 'offline';
      const sources = [...new Set(row.claims.map((c) => sourceLabel[c.source]))];
      const scopes = [...new Set(row.claims.map((c) => c.scope).filter((s): s is string => !!s))];
      return {
        row,
        names,
        macs,
        vendorNames,
        category,
        status,
        sources,
        haystack: [
          row.address,
          ...names,
          ...macs,
          ...vendorNames,
          ...scopes,
          ...sources,
          typeLabel[row.type],
          statusLabel[status],
          category?.name ?? '',
          row.discovered ? 'entdeckt' : '',
          row.conflict ? 'konflikt' : '',
        ]
          .join(' ')
          .toLocaleLowerCase('de'),
      };
    }),
  );

  const statusRank: Record<string, number> = { online: 0, offline: 1, unchecked: 2 };
  const sortValue = (e: (typeof entries)[number], key: string): string | number => {
    switch (key) {
      case 'address':
        return ipv4ToInt(e.row.address) ?? 0;
      case 'name':
        return e.names[0] ?? '';
      case 'type':
        return typeLabel[e.row.type];
      case 'status':
        return statusRank[e.status] ?? 3;
      case 'source':
        return e.sources.join(', ');
      case 'mac':
        return e.macs[0] ?? '';
      case 'vendor':
        return e.vendorNames[0] ?? '';
      default:
        return e.category?.name ?? '';
    }
  };

  const shown = $derived.by(() => {
    const tokens = tokensOf(query);
    const list = entries.filter((e) => {
      if (!matchesAll(e.haystack, tokens)) return false;
      if (typeSel.length > 0 && !typeSel.includes(e.row.type)) return false;
      if (statusSel.length > 0 && !statusSel.includes(e.status)) return false;
      if (flagSel.length > 0) {
        const flags = [e.row.discovered ? 'discovered' : '', e.row.conflict ? 'conflict' : ''];
        if (!flagSel.some((f) => flags.includes(f))) return false;
      }
      if (catSel.length > 0 && !catSel.includes(e.category ? String(e.category.id) : 'none'))
        return false;
      return true;
    });
    const factor = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const result =
        typeof x === 'number' && typeof y === 'number' ? x - y : compareText(String(x), String(y));
      // Leere Werte immer ans Ende, bei gleichen Werten nach Adresse
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      return result * factor || (ipv4ToInt(a.row.address) ?? 0) - (ipv4ToInt(b.row.address) ?? 0);
    });
  });

  // ---- Filter-Chips mit Zählern ----
  const count = (test: (e: (typeof entries)[number]) => boolean) => entries.filter(test).length;
  const groups = $derived<FilterGroup[]>([
    {
      key: 'type',
      label: 'Typ',
      selected: typeSel,
      options: (['reservation', 'lease', 'static'] as const).map((value) => ({
        value,
        label: typeLabel[value],
        count: count((e) => e.row.type === value),
      })),
    },
    {
      key: 'status',
      label: 'Status',
      selected: statusSel,
      options: (['online', 'offline', 'unchecked'] as const).map((value) => ({
        value,
        label: statusLabel[value],
        count: count((e) => e.status === value),
      })),
    },
    {
      key: 'flag',
      label: 'Merkmal',
      selected: flagSel,
      options: (['discovered', 'conflict'] as const).map((value) => ({
        value,
        label: flagLabel[value],
        count: count((e) => (value === 'discovered' ? e.row.discovered : e.row.conflict)),
      })),
    },
    {
      key: 'cat',
      label: 'Kategorie',
      selected: catSel,
      options: [
        ...categories
          .filter((c) => entries.some((e) => e.category?.id === c.id))
          .map((c) => ({
            value: String(c.id),
            label: c.name,
            count: count((e) => e.category?.id === c.id),
          })),
        ...(entries.some((e) => !e.category)
          ? [{ value: 'none', label: 'Ohne', count: count((e) => !e.category) }]
          : []),
      ],
    },
  ]);
  const columnOptions = $derived<ColumnOption[]>(
    COLUMNS.map(([key, label]) => ({ key, label, visible: visible(key) })),
  );
</script>

{#snippet th(key: string, label: string)}
  <th
    class="px-3 py-2 font-medium"
    aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
  >
    <button type="button" class="inline-flex items-center gap-1" onclick={() => sortBy(key)}>
      {label}
      {#if sort.key === key}
        <UiIcon name={sort.dir === 'asc' ? 'up' : 'down'} size={12} />
      {/if}
    </button>
  </th>
{/snippet}

<div class="grid min-w-0 gap-3">
  <FilterBar
    query={shownQuery}
    placeholder="Adresse, Name, MAC, Hersteller …"
    ariaLabel="Belegte Adressen durchsuchen"
    {groups}
    columns={columnOptions}
    shown={shown.length}
    total={entries.length}
    {ontoggle}
    ontogglecolumn={toggleColumn}
    {onquery}
    onreset={reset}
  >
    {#snippet extra()}
      <SavedViews scope="ipam" keys={VIEW_KEYS} {hidden} onapply={applyView} />
    {/snippet}
  </FilterBar>

  {#if entries.length === 0}
    <p class="text-sm text-fg-muted">Keine belegten Adressen in diesem Netz.</p>
  {:else if shown.length === 0}
    <p class="text-sm text-fg-muted">Keine Treffer.</p>
  {:else}
    <div class="relative overflow-x-auto rounded-2xl border border-line bg-elevated">
      <table class="w-full text-left text-sm">
        <thead class="text-xs text-fg-muted">
          <tr class="border-b border-line">
            {@render th('address', 'Adresse')}
            {#each COLUMNS as [key, label] (key)}
              {#if visible(key)}{@render th(key, label)}{/if}
            {/each}
            <th class="px-3 py-2"><span class="sr-only">Aktionen</span></th>
          </tr>
        </thead>
        <tbody>
          {#each shown as e (e.row.address)}
            {@const row = e.row}
            <tr
              class="border-t border-line align-top"
              class:bg-muted={selected === row.address}
              style={row.discovered ? 'background: var(--discovered-bg)' : ''}
            >
              <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                <button
                  type="button"
                  class="font-mono text-xs text-accent hover:underline"
                  aria-label="Details zu {row.address} öffnen"
                  onclick={() => onopen(row.address)}>{row.address}</button
                >
                {#if row.conflict}<span class="ml-1 font-sans font-semibold text-down"
                    >Konflikt</span
                  >{/if}
              </td>
              {#if visible('name')}
                <td class="px-3 py-2">
                  {#each e.names as name (name)}<span class="block">{name}</span>{:else}–{/each}
                </td>
              {/if}
              {#if visible('type')}
                <td class="px-3 py-2 whitespace-nowrap">
                  {typeLabel[row.type]}
                  {#if row.discovered}
                    <span
                      class="ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                      style="color: var(--discovered); border: 1px solid var(--discovered)"
                      >Entdeckt</span
                    >
                  {/if}
                </td>
              {/if}
              {#if visible('status')}
                <td class="px-3 py-2"><ReachDot alive={row.alive} lastSeen={row.lastSeen} /></td>
              {/if}
              {#if visible('source')}
                <td class="px-3 py-2 whitespace-nowrap text-fg-muted">{e.sources.join(', ')}</td>
              {/if}
              {#if visible('mac')}
                <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {#each e.macs as mac (mac)}<span class="block">{mac}</span>{:else}–{/each}
                </td>
              {/if}
              {#if visible('vendor')}
                <td class="px-3 py-2">
                  {#each e.macs as mac (mac)}
                    <span class="block text-xs" class:text-fg-muted={!vendors.label(mac)}
                      >{vendors.label(mac) || '…'}</span
                    >
                  {:else}<span class="text-fg-muted">–</span>{/each}
                </td>
              {/if}
              {#if visible('category')}
                <td class="px-3 py-2 whitespace-nowrap">
                  {#if e.category}
                    <span class="flex items-center gap-2">
                      <span
                        class="size-2.5 rounded-sm"
                        style="background: {categoryColor(e.category.color)}"
                      ></span>
                      {e.category.name}
                    </span>
                  {:else}<span class="text-fg-muted">–</span>{/if}
                </td>
              {/if}
              <td class="px-3 py-2 text-right whitespace-nowrap">
                {#if auth.isAdmin && row.claims.some((c) => c.hostId !== null)}
                  <button
                    type="button"
                    class="btn px-2.5 py-1 text-xs"
                    aria-label="{row.address} {row.discovered ? 'bestätigen' : 'bearbeiten'}"
                    onclick={() => onhost(row)}
                    >{row.discovered ? 'Bestätigen' : 'Bearbeiten'}</button
                  >
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="{row.address} vergessen"
                    onclick={() => onforget(row)}
                  >
                    <UiIcon name="trash" size={16} />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

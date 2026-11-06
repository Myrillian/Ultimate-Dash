<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { AuditEntry } from '@ultimate-dash/shared';
  import { api } from '$lib/api';
  import { actionLabel, areaLabels, areaOf, RANGES, rangeLabels, type AuditArea } from '$lib/audit';
  import { auth } from '$lib/auth.svelte';
  import { formatAgo } from '$lib/format';
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
  import FilterBar, { type FilterGroup } from '$lib/components/FilterBar.svelte';
  import SavedViews from '$lib/components/SavedViews.svelte';
  import TechNav from '$lib/components/TechNav.svelte';
  import UiIcon from '$lib/components/UiIcon.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';

  const LIMIT = 1000;
  let entries = $state<AuditEntry[] | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      entries = await api.audit(LIMIT);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Das Protokoll konnte nicht geladen werden';
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    if (auth.isAdmin) void load();
  });

  // ---- Suche, Filter und Sortierung; Zustand in der URL ----
  const SORT_KEYS = ['at', 'user', 'action', 'target', 'result'];
  const DEFAULT_SORT: SortState = { key: 'at', dir: 'desc' };
  const VIEW_KEYS = ['q', 'area', 'result', 'user', 'range', 'sort'] as const;
  const params = $derived(page.url.searchParams);
  const urlQuery = $derived(params.get('q') ?? '');
  const areaSel = $derived(splitList(params.get('area')));
  const resultSel = $derived(splitList(params.get('result')));
  const userSel = $derived(splitList(params.get('user')));
  const rangeSel = $derived(splitList(params.get('range')));
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
  const ontoggle = (group: string, value: string) => {
    const current =
      { area: areaSel, result: resultSel, user: userSel, range: rangeSel }[group] ?? [];
    // Der Zeitraum ist eine Einzelauswahl.
    const next =
      group === 'range' ? (current.includes(value) ? [] : [value]) : toggleIn(current, value);
    setParams({ [group]: next.length > 0 ? next.join(',') : null });
  };
  const reset = () => {
    typed = null;
    setParams({ q: null, area: null, result: null, user: null, range: null });
  };
  const sortBy = (key: string) => {
    const next = nextSort(sort, key);
    setParams({ sort: formatSort(next) === formatSort(DEFAULT_SORT) ? null : formatSort(next) });
  };
  const applyView = (saved: Record<string, string>) => {
    typed = null;
    setParams(Object.fromEntries(VIEW_KEYS.map((key) => [key, saved[key] ?? null])));
  };

  const all = $derived(entries ?? []);
  const users = $derived(
    [...new Set(all.map((e) => e.username ?? '(gelöscht)'))].sort(compareText),
  );
  const count = (test: (e: AuditEntry) => boolean) => all.filter(test).length;
  const userOf = (e: AuditEntry) => e.username ?? '(gelöscht)';

  const groups = $derived<FilterGroup[]>([
    {
      key: 'range',
      label: 'Zeitraum',
      selected: rangeSel,
      options: (Object.keys(RANGES) as (keyof typeof RANGES)[]).map((value) => ({
        value,
        label: rangeLabels[value],
      })),
    },
    {
      key: 'result',
      label: 'Ergebnis',
      selected: resultSel,
      options: [
        { value: 'ok', label: 'Erfolgreich', count: count((e) => e.ok) },
        { value: 'failed', label: 'Fehlgeschlagen', count: count((e) => !e.ok) },
      ],
    },
    {
      key: 'area',
      label: 'Bereich',
      selected: areaSel,
      options: (Object.keys(areaLabels) as AuditArea[]).map((value) => ({
        value,
        label: areaLabels[value],
        count: count((e) => areaOf(e.action) === value),
      })),
    },
    {
      key: 'user',
      label: 'Benutzer',
      selected: userSel,
      options: users.map((value) => ({
        value,
        label: value,
        count: count((e) => userOf(e) === value),
      })),
    },
  ]);

  const sortValue = (e: AuditEntry, key: string): string | number => {
    switch (key) {
      case 'user':
        return userOf(e);
      case 'action':
        return actionLabel(e.action);
      case 'target':
        return e.target ?? '';
      case 'result':
        return e.ok ? 1 : 0;
      default:
        return new Date(e.at).getTime();
    }
  };

  const rows = $derived.by(() => {
    const tokens = tokensOf(urlQuery);
    const factor = sort.dir === 'asc' ? 1 : -1;
    const since =
      rangeSel[0] && rangeSel[0] in RANGES
        ? Date.now() - RANGES[rangeSel[0] as keyof typeof RANGES]
        : 0;
    return all
      .filter(
        (e) =>
          (since === 0 || new Date(e.at).getTime() >= since) &&
          (resultSel.length === 0 || resultSel.includes(e.ok ? 'ok' : 'failed')) &&
          (areaSel.length === 0 || areaSel.includes(areaOf(e.action))) &&
          (userSel.length === 0 || userSel.includes(userOf(e))) &&
          matchesAll(
            [
              userOf(e),
              actionLabel(e.action),
              e.action,
              e.target ?? '',
              e.error ?? '',
              e.ok ? 'erfolgreich' : 'fehlgeschlagen',
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
        return factor * by || b.id - a.id;
      });
  });

  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'medium' });
</script>

{#snippet th(key: string, label: string)}
  <th
    class="px-3 py-2 font-medium"
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
      <UiIcon name="server" size={20} class="text-fg-muted" /> Änderungsprotokoll
    </h1>
    <TechNav />
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="icon-btn"
        aria-label="Neu laden"
        title="Neu laden"
        disabled={loading}
        onclick={() => load()}
      >
        <UiIcon name="refresh" size={16} class={loading ? 'animate-spin' : ''} />
      </button>
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

  {#if !auth.isAdmin}
    <div class="mx-auto max-w-md rounded-2xl border border-dashed border-line p-6 text-center">
      <p class="font-medium">Das Änderungsprotokoll ist nur für Admins sichtbar.</p>
    </div>
  {:else if error}
    <div
      class="mx-auto max-w-md rounded-2xl border border-down/40 bg-elevated p-6 text-center"
      role="alert"
    >
      <p class="font-medium">Das Protokoll konnte nicht geladen werden.</p>
      <p class="mt-1 text-sm text-fg-muted">{error}</p>
      <button type="button" class="btn mt-4" onclick={load}>Erneut versuchen</button>
    </div>
  {:else if !entries}
    <div class="grid gap-2" aria-busy="true" aria-label="Lädt">
      {#each Array(6) as _, i (i)}<div class="h-11 animate-pulse rounded-xl bg-muted"></div>{/each}
    </div>
  {:else}
    <section aria-label="Änderungen" class="grid min-w-0 gap-3">
      <FilterBar
        query={shownQuery}
        placeholder="Benutzer, Aktion, Ziel, Fehler …"
        ariaLabel="Protokoll durchsuchen"
        {groups}
        shown={rows.length}
        total={all.length}
        {ontoggle}
        {onquery}
        onreset={reset}
      >
        {#snippet extra()}
          <SavedViews scope="audit" keys={VIEW_KEYS} onapply={applyView} />
        {/snippet}
      </FilterBar>

      {#if all.length === 0}
        <p class="text-sm text-fg-muted">Noch keine Änderungen protokolliert.</p>
      {:else if rows.length === 0}
        <p class="text-sm text-fg-muted">Keine Treffer.</p>
      {:else}
        <div class="overflow-x-auto rounded-2xl border border-line bg-elevated">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-fg-muted">
              <tr class="border-b border-line">
                {@render th('at', 'Zeit')}
                {@render th('user', 'Benutzer')}
                {@render th('action', 'Aktion')}
                {@render th('target', 'Ziel')}
                {@render th('result', 'Ergebnis')}
              </tr>
            </thead>
            <tbody>
              {#each rows as e (e.id)}
                <tr class="border-t border-line align-top">
                  <td class="px-3 py-2 whitespace-nowrap" title={dateTime(e.at)}>
                    {dateTime(e.at)}
                    <span class="block text-xs text-fg-muted">{formatAgo(e.at)}</span>
                  </td>
                  <td class="px-3 py-2 whitespace-nowrap" class:text-fg-muted={!e.username}>
                    {userOf(e)}
                  </td>
                  <td class="px-3 py-2">
                    {actionLabel(e.action)}
                    <span class="block font-mono text-[11px] text-fg-muted">{e.action}</span>
                  </td>
                  <td class="max-w-md px-3 py-2 font-mono text-[13px] break-words">
                    {e.target ?? '–'}
                  </td>
                  <td class="px-3 py-2">
                    {#if e.ok}
                      <span class="text-up">Erfolgreich</span>
                    {:else}
                      <span class="font-semibold text-down">Fehlgeschlagen</span>
                      {#if e.error}<span class="block text-xs text-fg-muted">{e.error}</span>{/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if all.length >= LIMIT}
          <p class="text-xs text-fg-muted">Angezeigt werden die letzten {LIMIT} Einträge.</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

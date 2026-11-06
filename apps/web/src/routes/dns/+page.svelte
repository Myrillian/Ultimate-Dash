<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { DnsRecord, DnsRecordList, DnsZone } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { relativeName, type RecordFormValues } from '$lib/dns-records';
  import { theme } from '$lib/theme.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
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
  let query = $state('');
  let typeFilter = $state('');

  let form = $state<{ open: boolean; record: DnsRecord | null }>({ open: false, record: null });
  let confirm = $state<{ open: boolean; record: DnsRecord | null }>({ open: false, record: null });

  const selected = $derived(page.url.searchParams.get('zone'));
  const visibleZones = $derived(
    zones.filter((z) => z.name.toLowerCase().includes(zoneFilter.trim().toLowerCase())),
  );
  const records = $derived(list?.records ?? []);
  const types = $derived([...new Set(records.map((r) => r.type))].sort());
  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return records
      .filter(
        (r) =>
          (!typeFilter || r.type === typeFilter) &&
          (!q ||
            r.domain.toLowerCase().includes(q) ||
            r.display.toLowerCase().includes(q) ||
            (r.comments ?? '').toLowerCase().includes(q)),
      )
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.type.localeCompare(b.type));
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
      query = '';
      typeFilter = '';
      void loadRecords(selected);
    }
  });
  onMount(() => void loadZones());

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
            <label class="sr-only" for="rec-search">Records durchsuchen</label>
            <input
              id="rec-search"
              class="input w-48 py-1.5"
              type="search"
              placeholder="Suchen …"
              bind:value={query}
            />
            <label class="sr-only" for="rec-type-filter">Nach Typ filtern</label>
            <select id="rec-type-filter" class="input w-auto py-1.5" bind:value={typeFilter}>
              <option value="">Alle Typen</option>
              {#each types as type (type)}<option value={type}>{type}</option>{/each}
            </select>
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
                    <th class="px-4 py-2 font-medium">Name</th>
                    <th class="px-2 py-2 font-medium">Typ</th>
                    <th class="px-2 py-2 font-medium">Wert</th>
                    <th class="px-2 py-2 text-right font-medium">TTL</th>
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
                        <span class="block truncate font-mono text-[13px]" title={record.display}
                          >{record.display}</span
                        >
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
            <p class="text-xs text-fg-muted">
              {rows.length}{rows.length !== records.length ? ` von ${records.length}` : ''} Einträge
            </p>
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

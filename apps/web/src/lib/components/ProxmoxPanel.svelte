<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ProxmoxGuestCount, ProxmoxStorage } from '@ultimate-dash/shared';
  import { formatBytes, formatPercent, formatRate, formatUptime } from '$lib/format';
  import { proxmox, type ProxmoxView } from '$lib/proxmox.svelte';
  import GuestChip from './GuestChip.svelte';
  import Sparkline from './Sparkline.svelte';
  import UiIcon from './UiIcon.svelte';

  let { onconnect }: { onconnect: () => void } = $props();

  onMount(() => proxmox.start());
  onDestroy(() => proxmox.stop());

  const s = $derived(proxmox.summary);
  const percent = (share: number) => `${Math.round(share * 100)} %`;
  const storageTotals = $derived(
    (s?.storages ?? []).reduce(
      (sum, st) => ({ used: sum.used + st.used, total: sum.total + st.total }),
      { used: 0, total: 0 },
    ),
  );
  const offlineNodes = $derived((s?.nodes ?? []).filter((n) => !n.online));
  const uptimeLabel = $derived(
    s?.nodes.length === 1 && s.nodes[0]!.online
      ? ` · läuft seit ${formatUptime(s.nodes[0]!.uptime)}`
      : '',
  );
  const nodeLabel = $derived(
    !s ? '' : s.nodes.length === 1 ? s.nodes[0]!.name : `${s.nodes.length} Knoten`,
  );
  /** Vollste Datastores zuerst, damit Engpässe oben stehen. */
  const storages = $derived(
    [...(s?.storages ?? [])].sort((a, b) => b.used / b.total - a.used / a.total),
  );
  let allStorages = $state(false);
  const STORAGE_LIMIT = 6;

  const fill = (st: ProxmoxStorage) => (st.total > 0 ? st.used / st.total : 0);
  const fillColor = (share: number) =>
    share >= 0.95 ? 'var(--down)' : share >= 0.85 ? 'var(--cat-yellow)' : 'var(--chart-queries)';

  const VIEWS: { value: ProxmoxView; label: string; icon: 'view-bar' | 'view-compact' }[] = [
    { value: 'bar', label: 'Als Balken einklappen', icon: 'view-bar' },
    { value: 'compact', label: 'Kompakt: Kacheln und Datastores', icon: 'view-compact' },
  ];
</script>

{#snippet viewSwitch()}
  <div
    class="inline-flex shrink-0 rounded-lg border border-line bg-elevated p-0.5"
    role="radiogroup"
    aria-label="Größe des Proxmox-Bereichs"
  >
    {#each VIEWS as item (item.value)}
      <button
        type="button"
        role="radio"
        aria-checked={proxmox.view === item.value}
        aria-label={item.label}
        title={item.label}
        class="grid size-7 place-items-center rounded-md transition"
        class:bg-muted={proxmox.view === item.value}
        class:text-fg={proxmox.view === item.value}
        class:text-fg-muted={proxmox.view !== item.value}
        onclick={() => proxmox.setView(item.value)}
      >
        <UiIcon name={item.icon} size={15} />
      </button>
    {/each}
  </div>
{/snippet}

{#snippet guestTile(label: string, count: ProxmoxGuestCount)}
  <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
    <dt class="text-xs text-fg-muted">{label}</dt>
    <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
      {count.running}<span class="text-base font-normal text-fg-muted">&nbsp;/ {count.total}</span>
    </dd>
    <dd class="mt-0.5 text-xs text-fg-muted">
      {count.notRunning.length === 0 ? 'alle laufen' : 'laufen'}
    </dd>
    {#if count.notRunning.length > 0}
      <dd class="mt-1.5">
        <span class="sr-only">Nicht gestartet:</span>
        <ul class="grid gap-0.5 text-xs">
          {#each count.notRunning.slice(0, 5) as guest (guest.id)}
            <li class="flex items-baseline gap-1.5">
              <span class="size-1.5 shrink-0 rounded-full bg-unknown" aria-hidden="true"></span>
              <span class="min-w-0 truncate" title="{guest.id} · {guest.name}"
                ><span class="text-fg-muted tabular-nums">{guest.id}</span> {guest.name}</span
              >
            </li>
          {/each}
          {#if count.notRunning.length > 5}
            <li class="text-fg-muted">+{count.notRunning.length - 5} weitere</li>
          {/if}
        </ul>
      </dd>
    {/if}
  </div>
{/snippet}

{#if proxmox.status === 'not-configured'}
  <section
    class="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line p-4 sm:p-5"
    aria-label="Proxmox"
  >
    <span class="grid size-10 place-items-center rounded-xl bg-muted text-fg-muted">
      <UiIcon name="cpu" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium">Proxmox VE verbinden</p>
      <p class="text-sm text-fg-muted">
        Zeigt CPU, RAM, Durchsatz, Datastores und laufende VMs und Container. Nur lesend, nur für
        Admins sichtbar.
      </p>
    </div>
    <button type="button" class="btn btn-primary" onclick={onconnect}>Verbinden</button>
  </section>
{:else if proxmox.status !== 'idle' && proxmox.view === 'bar'}
  <!-- Eingeklappt: ein Balken mit den Kernwerten -->
  <section
    class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-elevated px-3 py-2 sm:px-4"
    aria-labelledby="pve-title"
  >
    <h2 id="pve-title" class="flex items-center gap-2 text-sm font-semibold">
      <UiIcon name="cpu" size={16} class="text-fg-muted" />
      <span class="sr-only sm:not-sr-only">Proxmox</span>
    </h2>
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg text-left text-xs text-fg-muted tabular-nums hover:text-fg sm:gap-x-4 [&>span]:whitespace-nowrap"
      title="Proxmox-Bereich ausklappen"
      class:opacity-60={proxmox.status === 'error'}
      onclick={() => proxmox.setView('compact')}
    >
      <span class="sr-only">Ausklappen:</span>
      {#if s}
        <span>CPU <b class="font-semibold text-fg">{percent(s.cpu.usage)}</b></span>
        <span class="sm:hidden"
          >RAM <b class="font-semibold text-fg">{formatPercent(s.memory.used, s.memory.total)}</b
          ></span
        >
        <span class="hidden sm:inline"
          >RAM <b class="font-semibold text-fg">{formatBytes(s.memory.used)}</b> / {formatBytes(
            s.memory.total,
          )}</span
        >
        {#if s.network}
          <span class="hidden sm:inline"
            >Netz <span aria-label="ein">↓</span>
            <b class="font-semibold text-fg">{formatRate(s.network.in)}</b>
            <span aria-label="aus">↑</span>
            <b class="font-semibold text-fg">{formatRate(s.network.out)}</b></span
          >
        {/if}
        {#if s.diskIo}
          <span class="hidden lg:inline"
            >Disk R <b class="font-semibold text-fg">{formatRate(s.diskIo.read)}</b> W
            <b class="font-semibold text-fg">{formatRate(s.diskIo.write)}</b></span
          >
        {/if}
        {#if storageTotals.total > 0}
          <span class="hidden md:inline"
            >Storage <b class="font-semibold text-fg">{formatBytes(storageTotals.used)}</b> / {formatBytes(
              storageTotals.total,
            )}</span
          >
        {/if}
      {:else if proxmox.status === 'error'}
        <span class="text-down [white-space:normal]!">Nicht verfügbar: {proxmox.error}</span>
      {:else}
        <span>Lädt …</span>
      {/if}
    </button>
    {#if s}
      <div class="flex shrink-0 items-center gap-1">
        <GuestChip id="pve-vms-stopped" label="VMs" count={s.vms} />
        <GuestChip id="pve-cts-stopped" label="CTs" count={s.containers} />
      </div>
    {/if}
    {#if proxmox.status === 'error'}
      {#if s}
        <span class="text-xs text-down" role="status" title={proxmox.error ?? ''}
          >Veraltet<span class="sr-only">: {proxmox.error}</span></span
        >
      {/if}
      <button type="button" class="btn py-1 text-xs" onclick={onconnect}>Verbindung prüfen</button>
    {/if}
    {#if offlineNodes.length > 0}
      <span class="rounded-full bg-down px-2 py-0.5 text-xs font-medium text-white" role="status">
        {offlineNodes.map((n) => n.name).join(', ')} offline
      </span>
    {/if}
    {@render viewSwitch()}
  </section>
{:else if proxmox.status !== 'idle'}
  <section class="grid min-w-0 gap-3" aria-labelledby="pve-title">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id="pve-title" class="flex items-center gap-2 font-semibold">
        <UiIcon name="cpu" size={16} class="text-fg-muted" /> Proxmox
      </h2>
      {#if s}
        <span class="text-sm text-fg-muted">
          {nodeLabel}{uptimeLabel}
        </span>
      {/if}
      {#if offlineNodes.length > 0}
        <span class="rounded-full bg-down px-2 py-0.5 text-xs font-medium text-white" role="status">
          {offlineNodes.map((n) => n.name).join(', ')} offline
        </span>
      {/if}
      <div class="ml-auto">{@render viewSwitch()}</div>
    </div>

    {#if proxmox.status === 'error' && !s}
      <div class="rounded-2xl border border-down/40 bg-elevated p-4 text-sm" role="alert">
        <p class="font-medium">Proxmox nicht verfügbar</p>
        <p class="mt-1 text-fg-muted">{proxmox.error}</p>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn" onclick={() => proxmox.load()}>Erneut versuchen</button>
          <button type="button" class="btn" onclick={onconnect}>Verbindung prüfen</button>
        </div>
      </div>
    {:else if !s}
      <div
        class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        aria-busy="true"
        aria-label="Lädt"
      >
        {#each Array(6) as _, i (i)}<div
            class="h-24 animate-pulse rounded-2xl bg-muted"
          ></div>{/each}
      </div>
    {:else}
      {#if proxmox.status === 'error'}
        <p class="text-xs text-down" role="status">
          Aktualisierung fehlgeschlagen: {proxmox.error}. Angezeigt wird der letzte Stand.
        </p>
      {/if}
      <dl
        class="grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 xl:grid-cols-6"
        class:opacity-60={proxmox.status === 'error'}
      >
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">CPU</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
            {percent(s.cpu.usage)}
          </dd>
          <dd class="mt-0.5 text-xs text-fg-muted">{s.cpu.cores} Kerne</dd>
          <dd class="mt-1"><Sparkline values={s.history.cpu} max={1} /></dd>
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">RAM</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
            {formatBytes(s.memory.used)}
          </dd>
          <dd class="mt-0.5 text-xs text-fg-muted tabular-nums">
            frei {formatBytes(s.memory.total - s.memory.used)} von {formatBytes(s.memory.total)}
          </dd>
          <dd class="mt-2">
            <div
              class="h-1.5 rounded-full bg-muted"
              role="img"
              aria-label="RAM {formatPercent(s.memory.used, s.memory.total)} belegt"
            >
              <div
                class="h-full rounded-full"
                style="width: {Math.min(
                  100,
                  (s.memory.used / (s.memory.total || 1)) * 100,
                )}%; background: {fillColor(s.memory.used / (s.memory.total || 1))}"
              ></div>
            </div>
          </dd>
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Netzwerk</dt>
          {#if s.network}
            <dd
              class="mt-1 text-lg font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-xl"
            >
              <span aria-label="ein">↓</span>
              {formatRate(s.network.in)}
            </dd>
            <dd class="mt-0.5 text-xs text-fg-muted tabular-nums">
              <span aria-label="aus">↑</span>
              {formatRate(s.network.out)}
            </dd>
            <dd class="mt-1"><Sparkline values={s.history.netIn} /></dd>
          {:else}
            <dd class="mt-1 text-xl font-semibold text-fg-muted">–</dd>
          {/if}
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Storage-I/O</dt>
          {#if s.diskIo}
            <dd
              class="mt-1 text-lg font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-xl"
            >
              <span class="text-sm font-normal text-fg-muted">R</span>
              {formatRate(s.diskIo.read)}
            </dd>
            <dd class="mt-0.5 text-xs text-fg-muted tabular-nums">
              W {formatRate(s.diskIo.write)} · Summe der Gäste
            </dd>
          {:else}
            <dd class="mt-1 text-xl font-semibold text-fg-muted">–</dd>
            <dd class="mt-0.5 text-xs text-fg-muted">Wert folgt beim nächsten Abruf</dd>
          {/if}
        </div>
        {@render guestTile('VMs', s.vms)}
        {@render guestTile('Container', s.containers)}
      </dl>

      {#if storages.length > 0}
        <div
          class="grid gap-x-6 gap-y-2 rounded-2xl border border-line bg-elevated p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3"
        >
          <h3 class="text-xs text-fg-muted sm:col-span-2 lg:col-span-3">Datastores</h3>
          <ul class="contents">
            {#each allStorages ? storages : storages.slice(0, STORAGE_LIMIT) as st (st.name)}
              {@const share = fill(st)}
              <li class="grid min-w-0 gap-1">
                <div class="flex items-baseline gap-2 text-xs">
                  <span class="min-w-0 truncate font-medium">{st.name}</span>
                  <span class="text-fg-muted">{st.type}{st.shared ? ' · geteilt' : ''}</span>
                  <span class="ml-auto whitespace-nowrap text-fg-muted tabular-nums"
                    >{formatBytes(st.used)} / {formatBytes(st.total)} ·
                    <b class="font-semibold text-fg">{percent(share)}</b></span
                  >
                </div>
                <div
                  class="h-1.5 rounded-full bg-muted"
                  role="img"
                  aria-label="{st.name}: {formatBytes(st.used)} von {formatBytes(st.total)} belegt"
                >
                  <div
                    class="h-full rounded-full"
                    style="width: {Math.min(100, share * 100)}%; background: {fillColor(share)}"
                  ></div>
                </div>
              </li>
            {/each}
          </ul>
          {#if storages.length > STORAGE_LIMIT}
            <button
              type="button"
              class="justify-self-start text-xs text-fg-muted hover:text-fg sm:col-span-2 lg:col-span-3"
              aria-expanded={allStorages}
              onclick={() => (allStorages = !allStorages)}
            >
              {allStorages ? 'Weniger anzeigen' : `Alle ${storages.length} anzeigen`}
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </section>
{/if}

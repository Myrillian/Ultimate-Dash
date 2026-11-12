<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ZoraxyHost } from '@ultimate-dash/shared';
  import { formatCount, formatDays } from '$lib/format';
  import { zoraxy, type ZoraxyView } from '$lib/zoraxy.svelte';
  import UiIcon from './UiIcon.svelte';

  let { onconnect }: { onconnect: () => void } = $props();

  onMount(() => zoraxy.start());
  onDestroy(() => zoraxy.stop());

  const s = $derived(zoraxy.summary);
  const WARN_DAYS = 14;
  const CRITICAL_DAYS = 3;
  const HOST_LIMIT = 8;
  let allHosts = $state(false);

  /** Hosts mit Problemen zuerst (nicht erreichbar, Zertifikat bald ab), dann der Rest. */
  const problem = (host: ZoraxyHost) =>
    host.enabled &&
    (host.online === false || (host.certDays !== null && host.certDays <= WARN_DAYS));
  const hosts = $derived(
    [...(s?.hosts ?? [])].sort((a, b) => Number(problem(b)) - Number(problem(a))),
  );
  const certTone = (days: number | null) =>
    days === null
      ? 'text-fg-muted'
      : days <= CRITICAL_DAYS
        ? 'text-down'
        : days <= WARN_DAYS
          ? 'text-[var(--cat-yellow)]'
          : 'text-fg-muted';
  const issues = $derived((s?.hosts ?? []).filter(problem).length);

  const VIEWS: { value: ZoraxyView; label: string; icon: 'view-bar' | 'view-compact' }[] = [
    { value: 'bar', label: 'Als Balken einklappen', icon: 'view-bar' },
    { value: 'list', label: 'Liste der Hosts', icon: 'view-compact' },
  ];

  const hostStatus = (host: ZoraxyHost) =>
    !host.enabled
      ? { label: 'deaktiviert', dot: 'bg-unknown' }
      : host.online === true
        ? { label: 'erreichbar', dot: 'bg-up' }
        : host.online === false
          ? { label: 'nicht erreichbar', dot: 'bg-down' }
          : { label: 'nicht überwacht', dot: 'bg-unknown' };
</script>

{#snippet viewSwitch()}
  <div
    class="inline-flex shrink-0 rounded-lg border border-line bg-elevated p-0.5"
    role="radiogroup"
    aria-label="Größe des Zoraxy-Bereichs"
  >
    {#each VIEWS as item (item.value)}
      <button
        type="button"
        role="radio"
        aria-checked={zoraxy.view === item.value}
        aria-label={item.label}
        title={item.label}
        class="grid size-7 place-items-center rounded-md transition"
        class:bg-muted={zoraxy.view === item.value}
        class:text-fg={zoraxy.view === item.value}
        class:text-fg-muted={zoraxy.view !== item.value}
        onclick={() => zoraxy.setView(item.value)}
      >
        <UiIcon name={item.icon} size={15} />
      </button>
    {/each}
  </div>
{/snippet}

{#if zoraxy.status === 'not-configured'}
  <section
    class="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line p-4 sm:p-5"
    aria-label="Zoraxy"
  >
    <span class="grid size-10 place-items-center rounded-xl bg-muted text-fg-muted">
      <UiIcon name="network" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-medium">Zoraxy verbinden</p>
      <p class="text-sm text-fg-muted">
        Zeigt Proxy-Hosts mit Erreichbarkeit, Ablauf der Zertifikate und die Anfragen des Tages. Nur
        lesend, nur für Admins sichtbar.
      </p>
    </div>
    <button type="button" class="btn btn-primary" onclick={onconnect}>Verbinden</button>
  </section>
{:else if zoraxy.status !== 'idle' && zoraxy.view === 'bar'}
  <!-- Eingeklappt: ein Balken mit den Kernwerten -->
  <section
    class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-elevated px-3 py-2 sm:px-4"
    aria-labelledby="zx-title"
  >
    <h2 id="zx-title" class="flex items-center gap-2 text-sm font-semibold">
      <UiIcon name="network" size={16} class="text-fg-muted" />
      <span class="sr-only sm:not-sr-only">Zoraxy</span>
    </h2>
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg text-left text-xs text-fg-muted tabular-nums hover:text-fg sm:gap-x-4 [&>span]:whitespace-nowrap"
      title="Zoraxy-Bereich ausklappen"
      class:opacity-60={zoraxy.status === 'error'}
      onclick={() => zoraxy.setView('list')}
    >
      <span class="sr-only">Ausklappen:</span>
      {#if s}
        <span>Hosts <b class="font-semibold text-fg">{s.counts.enabled}</b></span>
        {#if s.counts.online + s.counts.offline > 0}
          <span
            >erreichbar <b class="font-semibold text-fg">{s.counts.online}</b> / {s.counts.online +
              s.counts.offline}</span
          >
        {/if}
        {#if s.nextExpiryDays !== null}
          <span class={certTone(s.nextExpiryDays)}
            >Zertifikat <b class="font-semibold">{formatDays(s.nextExpiryDays)}</b></span
          >
        {/if}
        {#if s.requests}
          <span class="hidden sm:inline"
            >Anfragen heute <b class="font-semibold text-fg">{formatCount(s.requests.total)}</b>
            {#if s.requests.errors > 0}
              · Fehler <b class="font-semibold text-fg">{formatCount(s.requests.errors)}</b>
            {/if}</span
          >
        {/if}
      {:else if zoraxy.status === 'error'}
        <span class="text-down [white-space:normal]!">Nicht verfügbar: {zoraxy.error}</span>
      {:else}
        <span>Lädt …</span>
      {/if}
    </button>
    {#if issues > 0}
      <span
        class="rounded-full bg-down px-2 py-0.5 text-xs font-medium text-white"
        role="status"
        title="Hosts mit Problemen: nicht erreichbar oder Zertifikat läuft bald ab"
      >
        {issues}
        {issues === 1 ? 'Problem' : 'Probleme'}
      </span>
    {/if}
    {#if zoraxy.status === 'error'}
      {#if s}
        <span class="text-xs text-down" role="status" title={zoraxy.error ?? ''}
          >Veraltet<span class="sr-only">: {zoraxy.error}</span></span
        >
      {/if}
      <button type="button" class="btn py-1 text-xs" onclick={onconnect}>Verbindung prüfen</button>
    {/if}
    {@render viewSwitch()}
  </section>
{:else if zoraxy.status !== 'idle'}
  <section class="grid min-w-0 gap-3" aria-labelledby="zx-title">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id="zx-title" class="flex items-center gap-2 font-semibold">
        <UiIcon name="network" size={16} class="text-fg-muted" /> Zoraxy
      </h2>
      {#if s?.version}<span class="text-sm text-fg-muted">Version {s.version}</span>{/if}
      <div class="ml-auto">{@render viewSwitch()}</div>
    </div>

    {#if zoraxy.status === 'error' && !s}
      <div class="rounded-2xl border border-down/40 bg-elevated p-4 text-sm" role="alert">
        <p class="font-medium">Zoraxy nicht verfügbar</p>
        <p class="mt-1 text-fg-muted">{zoraxy.error}</p>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn" onclick={() => zoraxy.load()}>Erneut versuchen</button>
          <button type="button" class="btn" onclick={onconnect}>Verbindung prüfen</button>
        </div>
      </div>
    {:else if !s}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true" aria-label="Lädt">
        {#each Array(4) as _, i (i)}<div
            class="h-24 animate-pulse rounded-2xl bg-muted"
          ></div>{/each}
      </div>
    {:else}
      {#if zoraxy.status === 'error'}
        <p class="text-xs text-down" role="status">
          Aktualisierung fehlgeschlagen: {zoraxy.error}. Angezeigt wird der letzte Stand.
        </p>
      {/if}
      {#if s.warnings.length > 0}
        <p class="text-xs text-fg-muted" role="status">
          Nicht alles konnte gelesen werden: {s.warnings.join(', ')}.
        </p>
      {/if}
      <dl
        class="grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-4"
        class:opacity-60={zoraxy.status === 'error'}
      >
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Hosts</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
            {s.counts.enabled}
          </dd>
          <dd class="mt-0.5 text-xs text-fg-muted">
            {s.counts.hosts > s.counts.enabled
              ? `${s.counts.hosts - s.counts.enabled} deaktiviert`
              : 'alle aktiv'}
          </dd>
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Erreichbar</dt>
          {#if s.counts.online + s.counts.offline > 0}
            <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {s.counts.online}<span class="text-base font-normal text-fg-muted"
                >&nbsp;/ {s.counts.online + s.counts.offline}</span
              >
            </dd>
            <dd class="mt-0.5 text-xs text-fg-muted">
              {s.counts.offline === 0 ? 'alle antworten' : `${s.counts.offline} nicht erreichbar`}
            </dd>
          {:else}
            <dd class="mt-1 text-xl font-semibold text-fg-muted">–</dd>
            <dd class="mt-0.5 text-xs text-fg-muted">
              keine Uptime-Werte (Zoraxy › Uptime Monitor)
            </dd>
          {/if}
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Zertifikate</dt>
          {#if s.nextExpiryDays !== null}
            <dd
              class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl {certTone(
                s.nextExpiryDays,
              )}"
            >
              {formatDays(s.nextExpiryDays)}
            </dd>
            <dd class="mt-0.5 text-xs text-fg-muted">
              bis zum nächsten Ablauf · {s.certificates.length} insgesamt
            </dd>
          {:else}
            <dd class="mt-1 text-xl font-semibold text-fg-muted">–</dd>
            <dd class="mt-0.5 text-xs text-fg-muted">
              {s.certificates.length} Zertifikate, Ablauf unbekannt
            </dd>
          {/if}
        </div>
        <div class="min-w-0 rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <dt class="text-xs text-fg-muted">Anfragen heute</dt>
          {#if s.requests}
            <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {formatCount(s.requests.total)}
            </dd>
            <dd class="mt-0.5 text-xs text-fg-muted tabular-nums">
              {formatCount(s.requests.errors)} Fehler
            </dd>
          {:else}
            <dd class="mt-1 text-xl font-semibold text-fg-muted">–</dd>
          {/if}
        </div>
      </dl>

      {#if hosts.length > 0}
        <div class="rounded-2xl border border-line bg-elevated p-3 sm:p-4">
          <h3 class="mb-2 text-xs text-fg-muted">Proxy-Hosts</h3>
          <ul class="grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
            {#each allHosts ? hosts : hosts.slice(0, HOST_LIMIT) as host (host.domain)}
              {@const status = hostStatus(host)}
              <li
                class="flex min-w-0 items-baseline gap-2 text-sm"
                class:opacity-60={!host.enabled}
              >
                <span
                  class="size-2 shrink-0 translate-y-px rounded-full {status.dot}"
                  role="img"
                  aria-label={status.label}
                  title={status.label}
                ></span>
                <span class="min-w-0 truncate font-medium" title={host.domain}>{host.domain}</span>
                {#if host.upstreams[0]}
                  <span
                    class="hidden min-w-0 truncate text-xs text-fg-muted sm:inline"
                    title={host.upstreams.map((u) => u.target).join(', ')}
                    >→ {host.upstreams[0].target}{host.upstreams.length > 1
                      ? ` +${host.upstreams.length - 1}`
                      : ''}</span
                  >
                {/if}
                {#if host.hitsToday !== null}
                  <span
                    class="ml-auto shrink-0 text-xs text-fg-muted tabular-nums"
                    title="Aufrufe heute"
                  >
                    <b class="font-semibold text-fg">{formatCount(host.hitsToday)}</b>
                    <span class="sr-only">Aufrufe heute</span><span aria-hidden="true"> Hits</span>
                  </span>
                {/if}
                {#if host.certDays !== null}
                  <span
                    class="shrink-0 text-xs tabular-nums {certTone(host.certDays)}"
                    class:ml-auto={host.hitsToday === null}
                    title="Zertifikat"
                  >
                    <UiIcon name="shield" size={12} class="inline -translate-y-px" />
                    {formatDays(host.certDays)}
                  </span>
                {:else if host.hitsToday === null}
                  <span class="ml-auto"></span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if hosts.length > HOST_LIMIT}
            <button
              type="button"
              class="mt-2 text-xs text-fg-muted hover:text-fg"
              aria-expanded={allHosts}
              onclick={() => (allHosts = !allHosts)}
            >
              {allHosts ? 'Weniger anzeigen' : `Alle ${hosts.length} anzeigen`}
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </section>
{/if}

<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import { toasts } from '$lib/toasts.svelte';
  import { updates } from '$lib/update.svelte';
  import Dialog from './Dialog.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let acknowledged = $state(false);
  let busy = $state(false);
  let message = $state<string | null>(null);
  /** Version, auf die gerade aktualisiert wird; null = es läuft nichts. */
  let installing = $state<string | null>(null);
  let seenOffline = $state(false);
  let finished = $state(false);

  const status = $derived(updates.status);
  const latest = $derived(status?.latest ?? null);
  const progress = $derived(status?.progress ?? null);
  /** Auch ein Lauf aus einer früheren Sitzung oder von einem anderen Admin zählt. */
  const running = $derived(
    installing !== null || progress?.state === 'queued' || progress?.state === 'running',
  );

  $effect(() => {
    if (!open) return;
    acknowledged = false;
    message = null;
    void updates.load();
  });

  // Während der Installation alle 3 Sekunden nachsehen; der Neustart unterbricht die Antworten.
  $effect(() => {
    if (!open || !running || finished) return;
    const timer = setInterval(async () => {
      const next = await updates.poll();
      if (!next) {
        seenOffline = true;
        return;
      }
      const target = installing ?? next.progress?.version ?? null;
      if (next.progress?.state === 'failed') {
        installing = null;
        return;
      }
      const done =
        target !== null &&
        !next.updateAvailable &&
        (!next.progress || next.progress.state === 'ok');
      if (done && (seenOffline || next.currentVersion === target.replace(/^v/, ''))) {
        finished = true;
        installing = null;
      }
    }, 3000);
    return () => clearInterval(timer);
  });

  function describe(error: unknown): string {
    return error instanceof ApiError || error instanceof Error
      ? error.message
      : 'Unbekannter Fehler';
  }

  async function check() {
    message = null;
    await updates.load(true);
  }

  async function install() {
    if (!latest || !acknowledged) return;
    busy = true;
    message = null;
    try {
      updates.status = await api.installUpdate({ version: latest.version, acknowledged: true });
      installing = latest.version;
      seenOffline = false;
      finished = false;
    } catch (error) {
      message = describe(error);
      toasts.show(message, 'error');
    } finally {
      busy = false;
    }
  }

  function formatDate(value: string | null): string {
    if (!value) return '';
    return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<Dialog {open} {onclose} title="Updates">
  <div class="grid gap-4">
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-fg-muted">Installiert</dt>
      <dd>Version {status?.currentVersion ?? '…'}</dd>
      <dt class="text-fg-muted">Zuletzt geprüft</dt>
      <dd>{status?.checkedAt ? formatDate(status.checkedAt) : 'noch nicht'}</dd>
    </dl>

    {#if updates.error}
      <p class="rounded-lg bg-down px-3 py-2 text-sm text-white" role="alert">{updates.error}</p>
    {:else if status?.error}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm" role="alert">{status.error}</p>
    {/if}

    {#if status?.mode === 'disabled'}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm">
        Die Update-Prüfung ist abgeschaltet (<code>UPDATE_CHECK=false</code>). Das Dashboard fragt
        nicht bei GitHub nach.
      </p>
    {:else if finished}
      <p class="rounded-lg bg-up px-3 py-2 text-sm text-white" role="status">
        Das Update ist installiert. Lade die Seite neu, um die neue Version zu verwenden.
      </p>
    {:else if running}
      <div class="rounded-lg border border-line p-3 text-sm" role="status" aria-live="polite">
        <p class="font-medium">
          Update auf Version {installing ?? progress?.version.replace(/^v/, '')} läuft …
        </p>
        <p class="mt-1 text-fg-muted">
          Zuerst wird ein Backup angelegt, dann gebaut und neu gestartet. Das dauert einige Minuten;
          das Dashboard ist dabei kurz nicht erreichbar. Dieses Fenster aktualisiert sich selbst.
        </p>
      </div>
    {:else if status?.updateAvailable && latest}
      {#if progress?.state === 'failed'}
        <p class="rounded-lg bg-down px-3 py-2 text-sm text-white" role="alert">
          Das letzte Update auf {progress.version} ist fehlgeschlagen: {progress.message}
        </p>
      {/if}
      <section aria-labelledby="update-latest">
        <h3 id="update-latest" class="font-semibold">
          Neue Version {latest.version} verfügbar
          {#if latest.publishedAt}
            <span class="text-sm font-normal text-fg-muted">({formatDate(latest.publishedAt)})</span
            >
          {/if}
        </h3>
        <h4 class="mt-3 text-sm font-medium">Änderungsprotokoll</h4>
        <!-- Fokussierbar, damit sich der Text auch per Tastatur scrollen lässt. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-muted p-3 text-sm"
          tabindex="0"
          role="region"
          aria-label="Änderungsprotokoll"
        >
          {#each status.releases as release (release.version)}
            <article class="mb-4 last:mb-0">
              <h5 class="font-semibold">
                {release.name}
                {#if release.version !== latest.version}
                  <span class="font-normal text-fg-muted">({release.version})</span>
                {/if}
              </h5>
              <!-- Reiner Text: Release-Notizen kommen von außen und werden nie als HTML eingefügt. -->
              <p class="mt-1 whitespace-pre-wrap">{release.body.trim() || 'Keine Beschreibung.'}</p>
              {#if release.url}
                <a
                  class="mt-1 inline-block text-sm underline"
                  href={release.url}
                  target="_blank"
                  rel="noopener noreferrer">Auf GitHub ansehen</a
                >
              {/if}
            </article>
          {/each}
        </div>
      </section>

      {#if status.mode === 'self'}
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" class="mt-0.5" bind:checked={acknowledged} />
          <span>
            Ich habe das Änderungsprotokoll gelesen und möchte Version {latest.version} installieren.
            <span class="block text-xs text-fg-muted"
              >Vorher wird automatisch ein Backup angelegt. Schlägt das Update fehl, wird der alte
              Stand wiederhergestellt.</span
            >
          </span>
        </label>
      {:else if status.manualHint}
        <p class="rounded-lg bg-muted px-3 py-2 text-sm">
          Die Installation aus der Oberfläche ist bei dieser Einrichtung nicht möglich. {status.manualHint}
        </p>
      {/if}
    {:else if status && !status.error}
      <p class="text-sm">
        {#if latest}
          Du verwendest die neueste Version.
        {:else}
          Es gibt noch keine veröffentlichte Version zum Vergleichen.
        {/if}
      </p>
    {/if}

    {#if message}
      <p class="field-error" role="alert">{message}</p>
    {/if}
  </div>

  {#snippet footer()}
    {#if finished}
      <button type="button" class="btn btn-primary" onclick={() => location.reload()}>
        Seite neu laden
      </button>
    {:else}
      {#if status?.mode !== 'disabled'}
        <button
          type="button"
          class="btn mr-auto"
          disabled={updates.loading || running}
          onclick={check}
        >
          {updates.loading ? 'Prüft …' : 'Jetzt prüfen'}
        </button>
      {/if}
      {#if status?.mode === 'self' && status.updateAvailable && !running}
        <button
          type="button"
          class="btn btn-primary"
          disabled={!acknowledged || busy}
          onclick={install}
        >
          {busy ? 'Startet …' : `Version ${latest?.version} installieren`}
        </button>
      {/if}
    {/if}
  {/snippet}
</Dialog>

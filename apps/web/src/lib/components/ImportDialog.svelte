<script lang="ts">
  import type { ImportMode, ImportSummary } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { dashboard } from '$lib/dashboard.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let yaml = $state('');
  let fileName = $state<string | null>(null);
  let mode = $state<ImportMode>('merge');
  let preview = $state<ImportSummary | null>(null);
  let problems = $state<string[]>([]);
  let checking = $state(false);
  let importing = $state(false);
  let dragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    yaml = '';
    fileName = null;
    mode = 'merge';
    preview = null;
    problems = [];
  });

  // Bei jeder Änderung von Datei oder Modus neu prüfen (Probelauf ohne Speichern).
  $effect(() => {
    const text = yaml;
    const currentMode = mode;
    if (!open || !text.trim()) {
      preview = null;
      problems = [];
      return;
    }
    checking = true;
    const timer = setTimeout(async () => {
      try {
        preview = await api.importConfig({ yaml: text, mode: currentMode, dryRun: true });
        problems = [];
      } catch (error) {
        preview = null;
        problems = describe(error);
      } finally {
        checking = false;
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  function describe(error: unknown): string[] {
    if (error instanceof ApiError && error.issues.length > 0) {
      return error.issues.slice(0, 8).map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
    }
    return [error instanceof Error ? error.message : 'Prüfung fehlgeschlagen'];
  }

  /** ['groups', 0, 'services', 1, 'url'] → „Gruppe 1 › Service 2 › url“ */
  function formatPath(path: (string | number)[]): string {
    const parts: string[] = [];
    for (let i = 0; i < path.length; i++) {
      const part = path[i];
      const next = path[i + 1];
      if (part === 'groups' && typeof next === 'number') {
        parts.push(`Gruppe ${next + 1}`);
        i++;
      } else if (part === 'services' && typeof next === 'number') {
        parts.push(`Service ${next + 1}`);
        i++;
      } else parts.push(String(part));
    }
    return parts.join(' › ') || 'Datei';
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      problems = ['Die Datei ist größer als 2 MB.'];
      return;
    }
    fileName = file.name;
    yaml = await file.text();
  }

  async function submit() {
    importing = true;
    try {
      const result = await api.importConfig({ yaml, mode, dryRun: false });
      const count = result.servicesCreated + result.servicesUpdated;
      toasts.show(`Importiert: ${count} ${count === 1 ? 'Service' : 'Services'}`);
      await dashboard.load();
      onclose();
    } catch (error) {
      problems = describe(error);
    } finally {
      importing = false;
    }
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
</script>

<Dialog {open} {onclose} title="Konfiguration importieren">
  <div class="grid gap-4">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="grid place-items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition"
      class:border-accent={dragging}
      class:border-line={!dragging}
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(event) => {
        event.preventDefault();
        dragging = false;
        void readFile(event.dataTransfer?.files[0]);
      }}
    >
      <p class="text-sm">
        {#if fileName}
          <span class="font-medium">{fileName}</span>
        {:else}
          YAML-Datei hierher ziehen oder
        {/if}
      </p>
      <button type="button" class="btn" onclick={() => fileInput?.click()}>
        {fileName ? 'Andere Datei wählen' : 'Datei auswählen'}
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".yaml,.yml,application/yaml,text/yaml"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        onchange={(event) => void readFile(event.currentTarget.files?.[0])}
      />
    </div>

    <details>
      <summary class="cursor-pointer text-sm text-fg-muted">Oder Inhalt einfügen</summary>
      <label class="sr-only" for="import-text">YAML-Inhalt</label>
      <textarea
        id="import-text"
        class="input mt-2 h-40 font-mono text-xs"
        spellcheck="false"
        bind:value={yaml}
        oninput={() => (fileName = null)}
        placeholder={'version: 1\ngroups:\n  - name: Infrastruktur\n    services:\n      - name: Proxmox\n        url: https://pve.home.lan:8006'}
      ></textarea>
    </details>

    <fieldset class="grid gap-2">
      <legend class="field-label">Vorgehen</legend>
      <label class="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
        <input type="radio" name="import-mode" value="merge" bind:group={mode} class="mt-0.5" />
        <span>
          <span class="font-medium">Zusammenführen</span>
          <span class="block text-fg-muted"
            >Gruppen und Services mit gleichem Namen werden aktualisiert, neue ergänzt. Nichts wird
            gelöscht.</span
          >
        </span>
      </label>
      <label class="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
        <input type="radio" name="import-mode" value="replace" bind:group={mode} class="mt-0.5" />
        <span>
          <span class="font-medium">Ersetzen</span>
          <span class="block text-fg-muted"
            >Alle bestehenden Gruppen und Services werden gelöscht und durch die Datei ersetzt.</span
          >
        </span>
      </label>
    </fieldset>

    <div aria-live="polite">
      {#if checking}
        <p class="text-sm text-fg-muted">Prüft …</p>
      {:else if problems.length > 0}
        <div class="rounded-lg bg-down/10 p-3 text-sm text-down" role="alert">
          <p class="font-medium">Die Datei kann so nicht übernommen werden:</p>
          <ul class="mt-1 list-disc pl-5">
            {#each problems as problem, i (i)}<li>{problem}</li>{/each}
          </ul>
        </div>
      {:else if preview}
        <div class="rounded-lg bg-muted p-3 text-sm">
          <p class="font-medium">Vorschau</p>
          <ul class="mt-1 grid gap-0.5 text-fg-muted">
            {#if mode === 'replace'}
              <li class="text-down">
                Entfernt: {plural(preview.groupsRemoved, 'Gruppe', 'Gruppen')}, {plural(
                  preview.servicesRemoved,
                  'Service',
                  'Services',
                )}
              </li>
            {/if}
            <li>
              Neu: {plural(preview.groupsCreated, 'Gruppe', 'Gruppen')}, {plural(
                preview.servicesCreated,
                'Service',
                'Services',
              )}
            </li>
            {#if mode === 'merge'}
              <li>
                Aktualisiert: {plural(preview.groupsUpdated, 'Gruppe', 'Gruppen')}, {plural(
                  preview.servicesUpdated,
                  'Service',
                  'Services',
                )}
              </li>
            {/if}
            {#if preview.titleChanged}<li>Der Titel des Dashboards wird geändert.</li>{/if}
          </ul>
        </div>
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button
      type="button"
      class="btn {mode === 'replace' ? 'btn-danger' : 'btn-primary'}"
      disabled={!preview || checking || importing}
      onclick={submit}
    >
      {importing ? 'Importiert …' : mode === 'replace' ? 'Alles ersetzen' : 'Importieren'}
    </button>
  {/snippet}
</Dialog>

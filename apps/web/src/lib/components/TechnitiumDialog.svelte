<script lang="ts">
  import type { TechnitiumSettings } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { dns } from '$lib/dns.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let current = $state<TechnitiumSettings | null>(null);
  let url = $state('');
  let token = $state('');
  let tlsInsecure = $state(false);
  let errors = $state<Record<string, string>>({});
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let busy = $state<'test' | 'save' | 'disconnect' | null>(null);

  const readonly = $derived(current?.source === 'env');

  $effect(() => {
    if (!open) return;
    url = '';
    errors = {};
    result = null;
    token = '';
    void api
      .technitiumSettings()
      .then((settings) => {
        current = settings;
        // Nicht überschreiben, falls schon getippt wurde, während die Einstellungen luden.
        if (!url) url = settings.url ?? '';
        if (settings.url) tlsInsecure = settings.tlsInsecure;
      })
      .catch((error) => {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : 'Laden fehlgeschlagen',
        };
      });
  });

  const input = () => ({ url, token: token || undefined, tlsInsecure });

  function handle(error: unknown) {
    if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
    else result = { ok: false, message: error instanceof Error ? error.message : 'Fehlgeschlagen' };
  }

  async function test() {
    busy = 'test';
    errors = {};
    result = null;
    try {
      const info = await api.testTechnitium(input());
      result = {
        ok: true,
        message: `Verbunden mit ${info.serverDomain} (Technitium ${info.version})`,
      };
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = 'save';
    errors = {};
    result = null;
    try {
      const info = await api.saveTechnitium(input());
      toasts.show(`Technitium verbunden: ${info.serverDomain}`);
      await dns.load();
      onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }

  async function disconnect() {
    busy = 'disconnect';
    try {
      await api.disconnectTechnitium();
      toasts.show('Verbindung zu Technitium getrennt');
      await dns.load();
      onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }
</script>

<Dialog {open} {onclose} title="Technitium DNS">
  <form id="technitium-form" class="grid gap-4" onsubmit={save} novalidate>
    {#if readonly}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm">
        Die Verbindung ist über die Umgebungsvariablen <code>TECHNITIUM_URL</code> und
        <code>TECHNITIUM_TOKEN</code> festgelegt. Ändern lässt sie sich nur dort.
      </p>
    {/if}
    <div>
      <label class="field-label" for="tech-url">Adresse der Weboberfläche</label>
      <input
        id="tech-url"
        class="input"
        type="url"
        inputmode="url"
        placeholder="http://192.168.1.53:5380"
        bind:value={url}
        disabled={readonly}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.url}
        aria-describedby="tech-url-hint{errors.url ? ' tech-url-err' : ''}"
      />
      {#if errors.url}<p id="tech-url-err" class="field-error">{errors.url}</p>{/if}
      <p id="tech-url-hint" class="field-hint">
        Dieselbe Adresse, unter der du Technitium im Browser öffnest.
      </p>
    </div>

    {#if !readonly}
      <div>
        <label class="field-label" for="tech-token">API-Token</label>
        <PasswordInput
          id="tech-token"
          bind:value={token}
          autocomplete="off"
          placeholder={current?.hasToken ? 'Gespeichert – leer lassen zum Behalten' : ''}
          error={errors.token}
          hint="In Technitium unter Administration › Sessions › Create Token. Für die Statistik genügt „Dashboard: View“, fürs Blocking zusätzlich „Settings: Modify“."
        />
      </div>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={tlsInsecure} />
        <span>
          Zertifikat nicht prüfen
          <span class="block text-xs text-fg-muted"
            >Nur für https mit selbst signiertem Zertifikat.</span
          >
        </span>
      </label>
    {/if}

    <div aria-live="polite">
      {#if result}
        <p
          class="rounded-lg px-3 py-2 text-sm"
          class:bg-down={!result.ok}
          class:bg-up={result.ok}
          class:text-white={true}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.message}
        </p>
      {/if}
    </div>
  </form>

  {#snippet footer()}
    {#if current?.source === 'settings'}
      <button
        type="button"
        class="btn mr-auto text-down"
        disabled={busy !== null}
        onclick={disconnect}>Trennen</button
      >
    {/if}
    <button type="button" class="btn" disabled={busy !== null || !url} onclick={test}>
      {busy === 'test' ? 'Prüft …' : 'Verbindung prüfen'}
    </button>
    {#if !readonly}
      <button type="submit" form="technitium-form" class="btn btn-primary" disabled={busy !== null}>
        {busy === 'save' ? 'Speichert …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

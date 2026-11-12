<script lang="ts">
  import type { ZoraxySettings } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { zoraxy } from '$lib/zoraxy.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let current = $state<ZoraxySettings | null>(null);
  let url = $state('');
  let username = $state('');
  let password = $state('');
  let tlsInsecure = $state(false);
  let errors = $state<Record<string, string>>({});
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let warning = $state<string | null>(null);
  let busy = $state<'test' | 'save' | 'disconnect' | null>(null);

  const readonly = $derived(current?.source === 'env');
  /** Das gespeicherte Passwort gilt nur für den gespeicherten Benutzer. */
  const keepsPassword = $derived(!!current?.hasPassword && username.trim() === current.username);

  $effect(() => {
    if (!open) return;
    url = '';
    username = '';
    password = '';
    errors = {};
    result = null;
    warning = null;
    void api
      .zoraxySettings()
      .then((settings) => {
        current = settings;
        // Nicht überschreiben, falls schon getippt wurde, während die Einstellungen luden.
        if (!url) url = settings.url ?? '';
        if (!username) username = settings.username ?? '';
        if (settings.url) tlsInsecure = settings.tlsInsecure;
      })
      .catch((error) => {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : 'Laden fehlgeschlagen',
        };
      });
  });

  const input = () => ({ url, username, password: password || undefined, tlsInsecure });

  function handle(error: unknown) {
    if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
    else result = { ok: false, message: error instanceof Error ? error.message : 'Fehlgeschlagen' };
  }

  function describe(info: Awaited<ReturnType<typeof api.testZoraxy>>) {
    warning = info.warnings.length > 0 ? `${info.warnings.join(', ')}.` : null;
    const version = info.version ? ` (Zoraxy ${info.version})` : '';
    return `Verbunden${version}: ${info.hosts} Hosts, davon ${info.enabledHosts} aktiv, ${info.certificates} Zertifikate`;
  }

  async function test() {
    busy = 'test';
    errors = {};
    result = null;
    warning = null;
    try {
      result = { ok: true, message: describe(await api.testZoraxy(input())) };
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
    warning = null;
    try {
      const info = await api.saveZoraxy(input());
      const message = describe(info);
      toasts.show(`Zoraxy verbunden: ${info.hosts} Hosts`);
      await zoraxy.load();
      // Mit Warnung offen lassen, damit sie gelesen werden kann.
      if (warning) result = { ok: true, message };
      else onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }

  async function disconnect() {
    busy = 'disconnect';
    try {
      await api.disconnectZoraxy();
      toasts.show('Verbindung zu Zoraxy getrennt');
      await zoraxy.load();
      onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }
</script>

<Dialog {open} {onclose} title="Zoraxy">
  <form id="zoraxy-form" class="grid gap-4" onsubmit={save} novalidate>
    {#if readonly}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm">
        Die Verbindung ist über die Umgebungsvariablen <code>ZORAXY_URL</code>,
        <code>ZORAXY_USERNAME</code> und <code>ZORAXY_PASSWORD</code> festgelegt. Ändern lässt sie sich
        nur dort.
      </p>
    {/if}
    <div>
      <label class="field-label" for="zx-url">Adresse</label>
      <input
        id="zx-url"
        class="input"
        type="url"
        inputmode="url"
        placeholder="http://zoraxy.home.lan:8000"
        bind:value={url}
        disabled={readonly}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.url}
        aria-describedby="zx-url-hint{errors.url ? ' zx-url-err' : ''}"
      />
      {#if errors.url}<p id="zx-url-err" class="field-error">{errors.url}</p>{/if}
      <p id="zx-url-hint" class="field-hint">
        Die Adresse der Zoraxy-Verwaltungsoberfläche (nicht die der Dienste dahinter), meist mit
        Port 8000.
      </p>
    </div>

    {#if !readonly}
      <div>
        <label class="field-label" for="zx-user">Benutzername</label>
        <input
          id="zx-user"
          class="input"
          bind:value={username}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? 'zx-user-err' : undefined}
        />
        {#if errors.username}<p id="zx-user-err" class="field-error">{errors.username}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="zx-password">Passwort</label>
        <PasswordInput
          id="zx-password"
          bind:value={password}
          autocomplete="off"
          placeholder={keepsPassword ? 'Gespeichert – leer lassen zum Behalten' : ''}
          error={errors.password}
          hint="Wird nur im Server gespeichert und nie wieder angezeigt."
        />
      </div>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={tlsInsecure} />
        <span>
          Zertifikat nicht prüfen
          <span class="block text-xs text-fg-muted"
            >Nur bei einer https-Adresse mit selbst signiertem Zertifikat nötig.</span
          >
        </span>
      </label>
    {/if}

    <div class="rounded-lg border border-line px-3 py-2 text-sm text-fg-muted">
      <p>
        <b class="text-fg">Hinweis zum Zugang:</b> Zoraxy kennt keine API-Tokens und nur ein einziges
        Konto mit Vollzugriff. Ultimate Dash meldet sich mit diesem Konto an, liest aber ausschließlich
        (Regeln, Zertifikate, Uptime, Anfrage-Zahlen) und ändert in Zoraxy nichts. Die Zugangsdaten verlassen
        den Server nie.
      </p>
    </div>

    <div aria-live="polite" class="grid gap-2">
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
      {#if warning}
        <p class="rounded-lg border border-down/40 px-3 py-2 text-sm" role="alert">
          Nicht alles konnte gelesen werden: {warning} Die Hostliste funktioniert trotzdem.
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
      <button type="submit" form="zoraxy-form" class="btn btn-primary" disabled={busy !== null}>
        {busy === 'save' ? 'Speichert …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

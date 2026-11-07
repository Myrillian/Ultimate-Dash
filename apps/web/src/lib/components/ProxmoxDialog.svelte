<script lang="ts">
  import type { ProxmoxSettings } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { proxmox } from '$lib/proxmox.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let current = $state<ProxmoxSettings | null>(null);
  let url = $state('');
  let tokenId = $state('');
  let secret = $state('');
  let tlsInsecure = $state(false);
  let errors = $state<Record<string, string>>({});
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let warning = $state<string | null>(null);
  let busy = $state<'test' | 'save' | 'disconnect' | null>(null);

  const readonly = $derived(current?.source === 'env');
  /** Das gespeicherte Secret gilt nur für die gespeicherte Token-ID. */
  const keepsSecret = $derived(!!current?.hasSecret && tokenId.trim() === current.tokenId);

  $effect(() => {
    if (!open) return;
    url = '';
    tokenId = '';
    secret = '';
    errors = {};
    result = null;
    warning = null;
    void api
      .proxmoxSettings()
      .then((settings) => {
        current = settings;
        // Nicht überschreiben, falls schon getippt wurde, während die Einstellungen luden.
        if (!url) url = settings.url ?? '';
        if (!tokenId) tokenId = settings.tokenId ?? '';
        if (settings.url) tlsInsecure = settings.tlsInsecure;
      })
      .catch((error) => {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : 'Laden fehlgeschlagen',
        };
      });
  });

  const input = () => ({ url, tokenId, secret: secret || undefined, tlsInsecure });

  function handle(error: unknown) {
    if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
    else result = { ok: false, message: error instanceof Error ? error.message : 'Fehlgeschlagen' };
  }

  function describe(info: Awaited<ReturnType<typeof api.testProxmox>>) {
    warning =
      info.extraPrivileges.length > 0
        ? `Das Token darf mehr als nötig (${info.extraPrivileges.slice(0, 5).join(', ')}${info.extraPrivileges.length > 5 ? ' …' : ''}). Ultimate Dash liest nur, trotzdem ist die Rolle PVEAuditor sicherer.`
        : null;
    return `Verbunden mit ${info.nodes.join(', ')} (Proxmox VE ${info.version}): ${info.vms} VMs, ${info.containers} Container`;
  }

  async function test() {
    busy = 'test';
    errors = {};
    result = null;
    warning = null;
    try {
      result = { ok: true, message: describe(await api.testProxmox(input())) };
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
      const info = await api.saveProxmox(input());
      const message = describe(info);
      toasts.show(`Proxmox verbunden: ${info.nodes.join(', ')}`);
      await proxmox.load();
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
      await api.disconnectProxmox();
      toasts.show('Verbindung zu Proxmox getrennt');
      await proxmox.load();
      onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }
</script>

<Dialog {open} {onclose} title="Proxmox VE">
  <form id="proxmox-form" class="grid gap-4" onsubmit={save} novalidate>
    {#if readonly}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm">
        Die Verbindung ist über die Umgebungsvariablen <code>PROXMOX_URL</code>,
        <code>PROXMOX_TOKEN_ID</code> und <code>PROXMOX_TOKEN_SECRET</code> festgelegt. Ändern lässt sie
        sich nur dort.
      </p>
    {/if}
    <div>
      <label class="field-label" for="pve-url">Adresse</label>
      <input
        id="pve-url"
        class="input"
        type="url"
        inputmode="url"
        placeholder="https://pve.home.lan:8006"
        bind:value={url}
        disabled={readonly}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.url}
        aria-describedby="pve-url-hint{errors.url ? ' pve-url-err' : ''}"
      />
      {#if errors.url}<p id="pve-url-err" class="field-error">{errors.url}</p>{/if}
      <p id="pve-url-hint" class="field-hint">
        Dieselbe Adresse, unter der du Proxmox im Browser öffnest, meist mit Port 8006.
      </p>
    </div>

    {#if !readonly}
      <div>
        <label class="field-label" for="pve-token-id">Token-ID</label>
        <input
          id="pve-token-id"
          class="input"
          placeholder="dashboard@pve!ultimate-dash"
          bind:value={tokenId}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.tokenId}
          aria-describedby={errors.tokenId ? 'pve-token-id-err' : undefined}
        />
        {#if errors.tokenId}<p id="pve-token-id-err" class="field-error">{errors.tokenId}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="pve-secret">Secret</label>
        <PasswordInput
          id="pve-secret"
          bind:value={secret}
          autocomplete="off"
          placeholder={keepsSecret ? 'Gespeichert – leer lassen zum Behalten' : ''}
          error={errors.secret}
          hint="Proxmox zeigt das Secret nur einmal beim Anlegen des Tokens. Es wird nur im Server gespeichert und nie wieder angezeigt."
        />
      </div>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={tlsInsecure} />
        <span>
          Zertifikat nicht prüfen
          <span class="block text-xs text-fg-muted"
            >Nur bei einem selbst signierten Zertifikat nötig.</span
          >
        </span>
      </label>

      <details class="rounded-lg border border-line px-3 py-2 text-sm">
        <summary class="cursor-pointer font-medium">Nur-Lese-Token in Proxmox anlegen</summary>
        <div class="mt-2 grid gap-2 text-fg-muted">
          <p>
            In der Proxmox-Shell (Knoten › Shell) einen eigenen Benutzer und ein Token mit der Rolle
            <b class="text-fg">PVEAuditor</b> anlegen. Diese Rolle darf nur lesen, Starten, Stoppen oder
            die Konsole sind damit nicht möglich.
          </p>
          <pre class="overflow-x-auto rounded bg-muted p-2 text-xs text-fg"><code
              >pveum user add dashboard@pve
pveum user token add dashboard@pve ultimate-dash --privsep 1
pveum acl modify / --tokens 'dashboard@pve!ultimate-dash' --roles PVEAuditor</code
            ></pre>
          <p>
            Der zweite Befehl gibt das Secret aus („value“). Alternativ in der Oberfläche unter
            Rechenzentrum › Berechtigungen › API-Token und dort unter Berechtigungen die Rolle für
            das Token vergeben.
          </p>
        </div>
      </details>
    {/if}

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
        <p class="rounded-lg border border-down/40 px-3 py-2 text-sm" role="alert">{warning}</p>
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
      <button type="submit" form="proxmox-form" class="btn btn-primary" disabled={busy !== null}>
        {busy === 'save' ? 'Speichert …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

<script lang="ts">
  import {
    DEFAULT_MAIL_PORTS,
    type MailEncryption,
    type MailSettings,
  } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const ENCRYPTIONS: { value: MailEncryption; label: string }[] = [
    { value: 'starttls', label: 'STARTTLS' },
    { value: 'tls', label: 'SSL/TLS' },
    { value: 'none', label: 'Keine' },
  ];

  let current = $state<MailSettings | null>(null);
  let host = $state('');
  let port = $state('587');
  let encryption = $state<MailEncryption>('starttls');
  let user = $state('');
  let password = $state('');
  let from = $state('');
  let publicUrl = $state('');
  let tlsInsecure = $state(false);
  let testTo = $state('');
  let errors = $state<Record<string, string>>({});
  let result = $state<{ ok: boolean; message: string } | null>(null);
  let busy = $state<'test' | 'save' | 'disconnect' | null>(null);

  const readonly = $derived(current?.source === 'env');
  /** Das gespeicherte Passwort gilt nur für denselben Server und Benutzer. */
  const keepsPassword = $derived(
    !!current?.hasPassword && host.trim() === current.host && user.trim() === (current.user ?? ''),
  );

  $effect(() => {
    if (!open) return;
    host = '';
    user = '';
    password = '';
    from = '';
    publicUrl = '';
    testTo = auth.user?.email ?? '';
    errors = {};
    result = null;
    void api
      .mailSettings()
      .then((settings) => {
        current = settings;
        // Nicht überschreiben, falls schon getippt wurde, während die Einstellungen luden.
        if (!host) host = settings.host ?? '';
        if (!user) user = settings.user ?? '';
        if (!from) from = settings.from ?? '';
        if (!publicUrl) publicUrl = settings.publicUrl ?? window.location.origin;
        if (settings.host) {
          port = String(settings.port ?? DEFAULT_MAIL_PORTS[settings.encryption]);
          encryption = settings.encryption;
          tlsInsecure = settings.tlsInsecure;
        }
      })
      .catch((error) => {
        result = {
          ok: false,
          message: error instanceof Error ? error.message : 'Laden fehlgeschlagen',
        };
      });
  });

  /** Beim Wechsel der Verschlüsselung den üblichen Port vorschlagen, wenn noch der alte Standard drinsteht. */
  function chooseEncryption(value: MailEncryption) {
    if (Object.values(DEFAULT_MAIL_PORTS).map(String).includes(port.trim()) || !port.trim()) {
      port = String(DEFAULT_MAIL_PORTS[value]);
    }
    encryption = value;
  }

  const input = () => ({
    host,
    port: Number(port),
    encryption,
    user: user || undefined,
    password: password || undefined,
    from,
    publicUrl: current?.publicUrlFromEnv ? undefined : publicUrl,
    tlsInsecure,
  });

  function handle(error: unknown) {
    if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
    else result = { ok: false, message: error instanceof Error ? error.message : 'Fehlgeschlagen' };
  }

  async function test() {
    busy = 'test';
    errors = {};
    result = null;
    try {
      const { to } = await api.testMail({ ...input(), to: testTo });
      result = { ok: true, message: `Testmail an ${to} verschickt. Bitte im Postfach nachsehen.` };
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
      const saved = await api.saveMail(input());
      toasts.show(`Mailserver ${saved.host} gespeichert`);
      await auth.load();
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
      await api.disconnectMail();
      toasts.show('Mailserver entfernt');
      await auth.load();
      onclose();
    } catch (error) {
      handle(error);
    } finally {
      busy = null;
    }
  }
</script>

<Dialog {open} {onclose} title="Mailserver">
  <form id="mail-form" class="grid gap-4" onsubmit={save} novalidate>
    <p class="text-sm text-fg-muted">
      Über diesen Server verschickt Ultimate Dash Links für „Passwort vergessen“. Ohne Mailserver
      sehen Admins die Anfragen in der Benutzerverwaltung.
    </p>
    {#if readonly}
      <p class="rounded-lg bg-muted px-3 py-2 text-sm">
        Der Mailserver ist über die Umgebungsvariablen <code>SMTP_HOST</code> und Co. festgelegt. Ändern
        lässt er sich nur dort. Eine Testmail geht trotzdem.
      </p>
    {/if}

    <div class="grid gap-4 sm:grid-cols-[1fr_7rem]">
      <div>
        <label class="field-label" for="mail-host">Server (IP oder DNS-Name)</label>
        <input
          id="mail-host"
          class="input"
          placeholder="mail.example.org"
          bind:value={host}
          disabled={readonly}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.host}
          aria-describedby={errors.host ? 'mail-host-err' : undefined}
        />
        {#if errors.host}<p id="mail-host-err" class="field-error">{errors.host}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="mail-port">Port</label>
        <input
          id="mail-port"
          class="input"
          inputmode="numeric"
          bind:value={port}
          disabled={readonly}
          autocomplete="off"
          aria-invalid={!!errors.port}
          aria-describedby={errors.port ? 'mail-port-err' : undefined}
        />
        {#if errors.port}<p id="mail-port-err" class="field-error">{errors.port}</p>{/if}
      </div>
    </div>

    <fieldset>
      <legend class="field-label">Verschlüsselung</legend>
      <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {#each ENCRYPTIONS as option (option.value)}
          <label class="flex items-center gap-2">
            <input
              type="radio"
              name="mail-encryption"
              value={option.value}
              checked={encryption === option.value}
              disabled={readonly}
              onchange={() => chooseEncryption(option.value)}
            />
            {option.label}
          </label>
        {/each}
      </div>
      <p class="field-hint">
        STARTTLS meist auf Port 587, SSL/TLS auf 465. „Keine“ nur im eigenen Netz, dann gehen auch
        Passwort und Links unverschlüsselt durchs Netz.
      </p>
    </fieldset>

    <div>
      <label class="field-label" for="mail-user">Benutzer</label>
      <input
        id="mail-user"
        class="input"
        placeholder="dash@example.org"
        bind:value={user}
        disabled={readonly}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.user}
        aria-describedby="mail-user-hint{errors.user ? ' mail-user-err' : ''}"
      />
      {#if errors.user}<p id="mail-user-err" class="field-error">{errors.user}</p>{/if}
      <p id="mail-user-hint" class="field-hint">
        Leer lassen, wenn der Server ohne Anmeldung annimmt.
      </p>
    </div>

    {#if !readonly && user.trim()}
      <div>
        <label class="field-label" for="mail-password">Passwort</label>
        <PasswordInput
          id="mail-password"
          bind:value={password}
          autocomplete="off"
          placeholder={keepsPassword ? 'Gespeichert – leer lassen zum Behalten' : ''}
          error={errors.password}
          hint="Wird nur im Server gespeichert und nie wieder angezeigt."
        />
      </div>
    {/if}

    <div>
      <label class="field-label" for="mail-from">Absender</label>
      <input
        id="mail-from"
        class="input"
        placeholder="Ultimate Dash <dash@example.org>"
        bind:value={from}
        disabled={readonly}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.from}
        aria-describedby={errors.from ? 'mail-from-err' : undefined}
      />
      {#if errors.from}<p id="mail-from-err" class="field-error">{errors.from}</p>{/if}
    </div>

    <div>
      <label class="field-label" for="mail-public-url">Adresse des Dashboards</label>
      <input
        id="mail-public-url"
        class="input"
        type="url"
        inputmode="url"
        placeholder="https://dash.example.org"
        bind:value={publicUrl}
        disabled={readonly || current?.publicUrlFromEnv}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!errors.publicUrl}
        aria-describedby="mail-public-url-hint{errors.publicUrl ? ' mail-public-url-err' : ''}"
      />
      {#if errors.publicUrl}<p id="mail-public-url-err" class="field-error">
          {errors.publicUrl}
        </p>{/if}
      <p id="mail-public-url-hint" class="field-hint">
        {current?.publicUrlFromEnv
          ? 'Über PUBLIC_URL festgelegt.'
          : 'Damit beginnen die Links in den Mails. Die Adresse, unter der alle das Dashboard öffnen.'}
      </p>
    </div>

    {#if !readonly && encryption !== 'none'}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={tlsInsecure} />
        <span>
          Zertifikat nicht prüfen
          <span class="block text-xs text-fg-muted"
            >Nur bei einem selbst signierten Zertifikat am Mailserver nötig.</span
          >
        </span>
      </label>
    {/if}

    <div class="rounded-lg border border-line p-3">
      <label class="field-label" for="mail-test-to">Testmail an</label>
      <div class="flex gap-2">
        <input
          id="mail-test-to"
          class="input"
          type="email"
          placeholder="du@example.org"
          bind:value={testTo}
          autocomplete="email"
          spellcheck="false"
          aria-invalid={!!errors.to}
          aria-describedby={errors.to ? 'mail-test-to-err' : undefined}
        />
        <button
          type="button"
          class="btn shrink-0"
          disabled={busy !== null || !host || !testTo}
          onclick={test}
        >
          {busy === 'test' ? 'Sendet …' : 'Testmail senden'}
        </button>
      </div>
      {#if errors.to}<p id="mail-test-to-err" class="field-error">{errors.to}</p>{/if}
    </div>

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
        onclick={disconnect}>Entfernen</button
      >
    {/if}
    {#if !readonly}
      <button type="submit" form="mail-form" class="btn btn-primary" disabled={busy !== null}>
        {busy === 'save' ? 'Prüft und speichert …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

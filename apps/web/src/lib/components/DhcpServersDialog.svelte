<script lang="ts">
  import type { DhcpServer } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';
  import PasswordInput from './PasswordInput.svelte';
  import UiIcon from './UiIcon.svelte';

  let { open, onclose, onchange }: { open: boolean; onclose: () => void; onchange: () => void } =
    $props();

  let servers = $state<DhcpServer[]>([]);
  let loadError = $state<string | null>(null);
  /** null = Liste, 'new' = neuer Server, sonst ID des bearbeiteten */
  let editing = $state<string | null>(null);
  let name = $state('');
  let url = $state('');
  let token = $state('');
  let useMainToken = $state(false);
  let tlsInsecure = $state(false);
  let errors = $state<Record<string, string>>({});
  let general = $state<string | null>(null);
  let busy = $state(false);
  let confirmDelete = $state<string | null>(null);

  const current = $derived(servers.find((s) => s.id === editing) ?? null);

  async function load() {
    try {
      servers = await api.dhcpServers();
      loadError = null;
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Laden fehlgeschlagen';
    }
  }

  $effect(() => {
    if (!open) return;
    editing = null;
    confirmDelete = null;
    void load();
  });

  function edit(server: DhcpServer | null) {
    editing = server?.id ?? 'new';
    name = server?.name ?? '';
    url = server?.url ?? '';
    token = '';
    useMainToken = server ? !server.ownToken : false;
    tlsInsecure = server?.tlsInsecure ?? false;
    errors = {};
    general = null;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    errors = {};
    general = null;
    const input = {
      name,
      url,
      token: useMainToken ? undefined : token || undefined,
      useMainToken,
      tlsInsecure,
    };
    try {
      const saved =
        editing === 'new'
          ? await api.addDhcpServer(input)
          : await api.updateDhcpServer(editing!, input);
      toasts.show(`${saved.name} gespeichert`);
      editing = null;
      await load();
      onchange();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else general = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  async function remove(server: DhcpServer) {
    busy = true;
    try {
      await api.deleteDhcpServer(server.id);
      toasts.show(`${server.name} entfernt`);
      confirmDelete = null;
      await load();
      onchange();
    } catch (error) {
      toasts.show(error instanceof Error ? error.message : 'Entfernen fehlgeschlagen', 'error');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="DHCP-Server">
  {#if editing === null}
    <div class="grid gap-3 text-sm">
      <p class="text-fg-muted">
        Laufen DHCP-Scopes auf mehreren Technitium-Servern (z. B. zwei Knoten mit geteiltem
        Bereich), trage die weiteren hier ein. Scopes, Leases und Reservierungen aller Server werden
        dann zusammen angezeigt, Änderungen gehen an den Server, der den Scope bedient.
      </p>
      {#if loadError}
        <p class="rounded-lg bg-down/10 px-3 py-2 text-down" role="alert">{loadError}</p>
      {/if}
      <ul class="grid gap-2">
        {#each servers as server (server.id)}
          <li class="flex items-start gap-3 rounded-xl border border-line p-3">
            <UiIcon name="server" size={18} class="mt-0.5 text-fg-muted" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">
                {server.name}
                {#if server.primary}<span class="ml-1 text-xs font-normal text-fg-muted"
                    >Hauptverbindung</span
                  >{/if}
              </p>
              <p class="truncate font-mono text-xs text-fg-muted">{server.url}</p>
              {#if server.primary}
                <p class="text-xs text-fg-muted">
                  Änderbar in den Einstellungen unter „Verbindungen › Technitium DNS“.
                </p>
              {:else if !server.ownToken}
                <p class="text-xs text-fg-muted">Nutzt das Token der Hauptverbindung.</p>
              {/if}
              {#if server.error}
                <p class="mt-1 text-xs text-down" role="status">
                  Letzter Abruf fehlgeschlagen: {server.error}
                </p>
              {/if}
            </div>
            {#if !server.primary}
              {#if confirmDelete === server.id}
                <button
                  type="button"
                  class="btn btn-danger px-2.5 py-1 text-xs"
                  disabled={busy}
                  onclick={() => remove(server)}>Entfernen</button
                >
                <button
                  type="button"
                  class="btn px-2.5 py-1 text-xs"
                  onclick={() => (confirmDelete = null)}>Abbrechen</button
                >
              {:else}
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="{server.name} bearbeiten"
                  onclick={() => edit(server)}><UiIcon name="pencil" size={15} /></button
                >
                <button
                  type="button"
                  class="icon-btn hover:text-down"
                  aria-label="{server.name} entfernen"
                  onclick={() => (confirmDelete = server.id)}
                  ><UiIcon name="trash" size={15} /></button
                >
              {/if}
            {/if}
          </li>
        {:else}
          {#if !loadError}
            <li class="text-fg-muted">Technitium ist noch nicht verbunden.</li>
          {/if}
        {/each}
      </ul>
    </div>
  {:else}
    <form id="dhcp-server-form" class="grid gap-4" onsubmit={save} novalidate>
      {#if general}
        <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{general}</p>
      {/if}
      <div>
        <label class="field-label" for="dhcp-srv-name">Name</label>
        <input
          id="dhcp-srv-name"
          class="input"
          bind:value={name}
          placeholder="dns2"
          autocomplete="off"
          aria-invalid={!!errors.name}
        />
        {#if errors.name}<p class="field-error">{errors.name}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="dhcp-srv-url">Adresse der Weboberfläche</label>
        <input
          id="dhcp-srv-url"
          class="input"
          type="url"
          inputmode="url"
          placeholder="http://10.10.0.54:5380"
          bind:value={url}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.url}
        />
        {#if errors.url}<p class="field-error">{errors.url}</p>{/if}
      </div>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={useMainToken} />
        <span>
          Token der Hauptverbindung verwenden
          <span class="block text-xs text-fg-muted"
            >Nur, wenn es auf diesem Server ebenfalls gilt (z. B. im Technitium-Cluster).</span
          >
        </span>
      </label>
      {#if !useMainToken}
        <PasswordInput
          id="dhcp-srv-token"
          bind:value={token}
          autocomplete="off"
          placeholder={current?.ownToken ? 'Gespeichert – leer lassen zum Behalten' : ''}
          error={errors.token}
          hint="Braucht in Technitium „DhcpServer: View“, zum Ändern zusätzlich Modify und Delete."
        />
      {/if}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={tlsInsecure} />
        <span>
          Zertifikat nicht prüfen
          <span class="block text-xs text-fg-muted"
            >Nur für https mit selbst signiertem Zertifikat.</span
          >
        </span>
      </label>
      <p class="text-xs text-fg-muted">
        Beim Speichern wird geprüft, ob der Server seine DHCP-Scopes liefert.
      </p>
    </form>
  {/if}

  {#snippet footer()}
    {#if editing === null}
      {#if servers.length > 0}
        <button type="button" class="btn btn-primary" onclick={() => edit(null)}>
          <UiIcon name="plus" size={16} /> Server hinzufügen
        </button>
      {/if}
    {:else}
      <button type="button" class="btn" disabled={busy} onclick={() => (editing = null)}
        >Zurück</button
      >
      <button type="submit" form="dhcp-server-form" class="btn btn-primary" disabled={busy}>
        {busy ? 'Prüft …' : 'Speichern'}
      </button>
    {/if}
  {/snippet}
</Dialog>

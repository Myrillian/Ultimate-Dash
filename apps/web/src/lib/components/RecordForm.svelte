<script lang="ts">
  import {
    editableRecordTypes,
    type DnsRecord,
    type EditableRecordType,
  } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import {
    dataToDraft,
    draftData,
    emptyDraft,
    fieldKey,
    fullName,
    relativeName,
    type RecordDraft,
    type RecordFormValues,
  } from '$lib/dns-records';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    zone: string;
    /** null = neuer Eintrag */
    record: DnsRecord | null;
    /** Vorbelegung beim Anlegen (z. B. aus dem IP-Seitenfenster) */
    initial?: Partial<RecordDraft> | null;
    onclose: () => void;
    onsubmit: (values: RecordFormValues) => Promise<void>;
  }

  let { open, zone, record, initial = null, onclose, onsubmit }: Props = $props();

  let draft = $state<RecordDraft>(emptyDraft());
  let errors = $state<Record<string, string>>({});
  let general = $state<string | null>(null);
  let busy = $state(false);

  const editing = $derived(record !== null);
  const isAddress = $derived(draft.type === 'A' || draft.type === 'AAAA');
  const preview = $derived(fullName(draft.name, zone));

  $effect(() => {
    if (!open) return;
    errors = {};
    general = null;
    draft = record?.data
      ? {
          ...emptyDraft(),
          ...dataToDraft(record.data),
          name: relativeName(record.domain, zone) === '@' ? '' : relativeName(record.domain, zone),
          ttl: record.ttl,
          comments: record.comments ?? '',
          disabled: record.disabled,
        }
      : { ...emptyDraft(), ...initial };
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    errors = {};
    general = null;
    try {
      await onsubmit({
        domain: fullName(draft.name, zone),
        ttl: Number(draft.ttl),
        comments: draft.comments,
        disabled: draft.disabled,
        createPtr: isAddress && draft.createPtr,
        data: draftData(draft),
      });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        errors = Object.fromEntries(error.issues.map((i) => [fieldKey(i.path), i.message]));
      } else general = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }

  const TYPE_HELP: Record<EditableRecordType, string> = {
    A: 'IPv4-Adresse',
    AAAA: 'IPv6-Adresse',
    CNAME: 'Alias auf einen anderen Namen',
    PTR: 'Rückwärtsauflösung (IP → Name)',
    MX: 'Mailserver',
    TXT: 'Text, z. B. SPF',
    NS: 'Namensserver',
    SRV: 'Dienst mit Port',
  };
</script>

<Dialog {open} {onclose} title={editing ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}>
  <form id="record-form" class="grid gap-4" onsubmit={submit} novalidate>
    {#if general}
      <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{general}</p>
    {/if}

    <div class="grid gap-4 sm:grid-cols-[10rem_1fr]">
      <div>
        <label class="field-label" for="rec-type">Typ</label>
        <select id="rec-type" class="input" bind:value={draft.type} disabled={editing}>
          {#each editableRecordTypes as type (type)}
            <option value={type}>{type}</option>
          {/each}
        </select>
        <p class="field-hint">{TYPE_HELP[draft.type]}</p>
      </div>
      <div>
        <label class="field-label" for="rec-name">Name</label>
        <div class="flex items-center gap-2">
          <input
            id="rec-name"
            class="input font-mono"
            bind:value={draft.name}
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="@"
            aria-invalid={!!errors.name}
            aria-describedby="rec-name-hint{errors.name ? ' rec-name-err' : ''}"
          />
        </div>
        <p id="rec-name-hint" class="field-hint">
          Ergibt <span class="font-mono text-fg">{preview}</span>. „@“ oder leer steht für die Zone
          selbst.
        </p>
        {#if errors.name}<p id="rec-name-err" class="field-error">{errors.name}</p>{/if}
      </div>
    </div>

    {#if draft.type === 'A' || draft.type === 'AAAA'}
      <div>
        <label class="field-label" for="rec-ip">IP-Adresse</label>
        <input
          id="rec-ip"
          class="input font-mono"
          bind:value={draft.ipAddress}
          autocomplete="off"
          spellcheck="false"
          placeholder={draft.type === 'A' ? '10.10.0.20' : 'fd00::20'}
          aria-invalid={!!errors.ipAddress}
          aria-describedby={errors.ipAddress ? 'rec-ip-err' : undefined}
        />
        {#if errors.ipAddress}<p id="rec-ip-err" class="field-error">{errors.ipAddress}</p>{/if}
      </div>
    {:else if draft.type === 'CNAME'}
      <div>
        <label class="field-label" for="rec-cname">Zielname</label>
        <input
          id="rec-cname"
          class="input font-mono"
          bind:value={draft.cname}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!!errors.cname}
        />
        {#if errors.cname}<p class="field-error">{errors.cname}</p>{/if}
      </div>
    {:else if draft.type === 'PTR'}
      <div>
        <label class="field-label" for="rec-ptr">Name des Geräts</label>
        <input
          id="rec-ptr"
          class="input font-mono"
          bind:value={draft.ptrName}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!!errors.ptrName}
        />
        {#if errors.ptrName}<p class="field-error">{errors.ptrName}</p>{/if}
      </div>
    {:else if draft.type === 'NS'}
      <div>
        <label class="field-label" for="rec-ns">Namensserver</label>
        <input
          id="rec-ns"
          class="input font-mono"
          bind:value={draft.nameServer}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!!errors.nameServer}
        />
        {#if errors.nameServer}<p class="field-error">{errors.nameServer}</p>{/if}
      </div>
    {:else if draft.type === 'TXT'}
      <div>
        <label class="field-label" for="rec-text">Text</label>
        <textarea
          id="rec-text"
          class="input h-24 font-mono text-xs"
          bind:value={draft.text}
          spellcheck="false"
          aria-invalid={!!errors.text}
        ></textarea>
        {#if errors.text}<p class="field-error">{errors.text}</p>{/if}
      </div>
    {:else if draft.type === 'MX'}
      <div class="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div>
          <label class="field-label" for="rec-pref">Priorität</label>
          <input
            id="rec-pref"
            class="input"
            type="number"
            min="0"
            max="65535"
            bind:value={draft.preference}
            aria-invalid={!!errors.preference}
          />
          {#if errors.preference}<p class="field-error">{errors.preference}</p>{/if}
        </div>
        <div>
          <label class="field-label" for="rec-mx">Mailserver</label>
          <input
            id="rec-mx"
            class="input font-mono"
            bind:value={draft.exchange}
            spellcheck="false"
            autocomplete="off"
            aria-invalid={!!errors.exchange}
          />
          {#if errors.exchange}<p class="field-error">{errors.exchange}</p>{/if}
        </div>
      </div>
    {:else if draft.type === 'SRV'}
      <div class="grid grid-cols-3 gap-4">
        {#each [['rec-prio', 'Priorität', 'priority'], ['rec-weight', 'Gewicht', 'weight'], ['rec-port', 'Port', 'port']] as const as [id, label, key] (id)}
          <div>
            <label class="field-label" for={id}>{label}</label>
            <input
              {id}
              class="input"
              type="number"
              min="0"
              max="65535"
              bind:value={draft[key]}
              aria-invalid={!!errors[key]}
            />
            {#if errors[key]}<p class="field-error">{errors[key]}</p>{/if}
          </div>
        {/each}
      </div>
      <div>
        <label class="field-label" for="rec-target">Ziel</label>
        <input
          id="rec-target"
          class="input font-mono"
          bind:value={draft.target}
          spellcheck="false"
          autocomplete="off"
          aria-invalid={!!errors.target}
        />
        {#if errors.target}<p class="field-error">{errors.target}</p>{/if}
      </div>
    {/if}

    <div class="grid gap-4 sm:grid-cols-[10rem_1fr]">
      <div>
        <label class="field-label" for="rec-ttl">TTL (Sekunden)</label>
        <input
          id="rec-ttl"
          class="input"
          type="number"
          min="1"
          bind:value={draft.ttl}
          aria-invalid={!!errors.ttl}
        />
        {#if errors.ttl}<p class="field-error">{errors.ttl}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="rec-comment">Kommentar</label>
        <input
          id="rec-comment"
          class="input"
          bind:value={draft.comments}
          maxlength="500"
          placeholder="optional"
        />
      </div>
    </div>

    {#if isAddress}
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-0.5" bind:checked={draft.createPtr} />
        <span>
          Passenden PTR-Eintrag mit anlegen
          <span class="block text-xs text-fg-muted">
            Fehlt die Reverse-Zone, wird sie dabei von Technitium erstellt.
          </span>
        </span>
      </label>
    {/if}
    {#if editing}
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={draft.disabled} />
        Eintrag deaktivieren (bleibt gespeichert, wird aber nicht beantwortet)
      </label>
    {/if}
  </form>

  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="record-form" class="btn btn-primary" disabled={busy}>
      {busy ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

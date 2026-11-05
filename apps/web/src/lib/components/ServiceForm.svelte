<script lang="ts">
  import type { DashboardGroup, Service, ServiceInput } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';
  import ServiceIcon from './ServiceIcon.svelte';

  interface Props {
    open: boolean;
    groups: DashboardGroup[];
    /** Zu bearbeitender Service; leer = neuer Service. */
    service?: Service | null;
    defaultGroupId?: number | null;
    onclose: () => void;
    onsubmit: (input: ServiceInput) => Promise<void>;
  }

  let { open, groups, service = null, defaultGroupId = null, onclose, onsubmit }: Props = $props();

  const empty = () => ({
    name: '',
    url: '',
    groupId: defaultGroupId ?? groups[0]?.id ?? 0,
    description: '',
    icon: '',
    target: '_blank' as const,
    statusCheck: true,
    statusUrl: '',
    tags: '',
  });

  let form = $state(empty());
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);
  let generalError = $state<string | null>(null);

  // Formular beim Öffnen mit den aktuellen Werten füllen.
  $effect(() => {
    if (!open) return;
    errors = {};
    generalError = null;
    form = service
      ? {
          name: service.name,
          url: service.url,
          groupId: service.groupId,
          description: service.description ?? '',
          icon: service.icon ?? '',
          target: service.target as '_blank',
          statusCheck: service.statusCheck,
          statusUrl: service.statusUrl ?? '',
          tags: service.tags.join(', '),
        }
      : empty();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    errors = {};
    generalError = null;
    try {
      await onsubmit({
        name: form.name,
        url: form.url.trim(),
        groupId: Number(form.groupId),
        description: form.description,
        icon: form.icon,
        target: form.target,
        statusCheck: form.statusCheck,
        statusUrl: form.statusUrl.trim() === '' ? null : form.statusUrl.trim(),
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) errors = error.fieldErrors();
      else generalError = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      saving = false;
    }
  }
</script>

<Dialog {open} {onclose} title={service ? 'Service bearbeiten' : 'Service hinzufügen'}>
  <form id="service-form" class="grid gap-4" onsubmit={submit} novalidate>
    <div class="flex items-start gap-3">
      <div class="pt-6">
        <ServiceIcon icon={form.icon || null} name={form.name || '?'} size={44} />
      </div>
      <div class="flex-1">
        <label class="field-label" for="svc-name">Name</label>
        <input
          id="svc-name"
          class="input"
          bind:value={form.name}
          required
          maxlength="80"
          autocomplete="off"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'svc-name-err' : undefined}
        />
        {#if errors.name}<p id="svc-name-err" class="field-error">{errors.name}</p>{/if}
      </div>
    </div>

    <div>
      <label class="field-label" for="svc-url">Adresse</label>
      <input
        id="svc-url"
        class="input"
        type="url"
        inputmode="url"
        placeholder="https://proxmox.home.lan:8006"
        bind:value={form.url}
        required
        aria-invalid={!!errors.url}
        aria-describedby={errors.url ? 'svc-url-err' : undefined}
      />
      {#if errors.url}<p id="svc-url-err" class="field-error">{errors.url}</p>{/if}
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="svc-group">Gruppe</label>
        <select id="svc-group" class="input" bind:value={form.groupId}>
          {#each groups as group (group.id)}
            <option value={group.id}>{group.name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="field-label" for="svc-target">Öffnen in</label>
        <select id="svc-target" class="input" bind:value={form.target}>
          <option value="_blank">Neuem Tab</option>
          <option value="_self">Gleichem Tab</option>
        </select>
      </div>
    </div>

    <div>
      <label class="field-label" for="svc-desc"
        >Beschreibung <span class="text-fg-muted">(optional)</span></label
      >
      <input id="svc-desc" class="input" bind:value={form.description} maxlength="200" />
    </div>

    <div>
      <label class="field-label" for="svc-icon"
        >Icon <span class="text-fg-muted">(optional)</span></label
      >
      <input
        id="svc-icon"
        class="input"
        placeholder="di:proxmox, sh:technitium, mdi:server oder https://…"
        bind:value={form.icon}
        aria-describedby="svc-icon-hint"
      />
      <p id="svc-icon-hint" class="field-hint">
        <code>di:</code> Dashboard Icons, <code>sh:</code> selfh.st, <code>mdi:</code>/<code
          >simple-icons:</code
        >
        Iconify oder eine Bild-URL.
      </p>
    </div>

    <div>
      <label class="field-label" for="svc-tags"
        >Tags <span class="text-fg-muted">(optional)</span></label
      >
      <input id="svc-tags" class="input" placeholder="dns, dhcp" bind:value={form.tags} />
      <p class="field-hint">Mit Komma trennen. Tags werden bei der Suche berücksichtigt.</p>
    </div>

    <fieldset class="grid gap-3 rounded-xl border border-line p-3">
      <legend class="px-1 text-sm font-medium">Statusprüfung</legend>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="size-4 accent-[var(--accent)]"
          bind:checked={form.statusCheck}
        />
        Erreichbarkeit regelmäßig prüfen
      </label>
      {#if form.statusCheck}
        <div>
          <label class="field-label" for="svc-status-url"
            >Abweichende Prüfadresse <span class="text-fg-muted">(optional)</span></label
          >
          <input
            id="svc-status-url"
            class="input"
            type="url"
            placeholder="http://10.10.0.5:8006"
            bind:value={form.statusUrl}
            aria-invalid={!!errors.statusUrl}
          />
          {#if errors.statusUrl}<p class="field-error">{errors.statusUrl}</p>{/if}
          <p class="field-hint">Nützlich, wenn der Link über einen Reverse-Proxy mit Login geht.</p>
        </div>
      {/if}
    </fieldset>

    {#if generalError}<p class="field-error" role="alert">{generalError}</p>{/if}
  </form>

  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="service-form" class="btn btn-primary" disabled={saving}>
      {saving ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

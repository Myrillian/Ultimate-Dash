<script lang="ts">
  import type { DhcpReservation, DhcpScope } from '@ultimate-dash/shared';
  import { dhcpScopeKey, ipv4InRange, multipleDhcpServers } from '@ultimate-dash/shared';
  import { ApiError } from '$lib/api';
  import Dialog from './Dialog.svelte';

  export interface ReservationValues {
    /** Schlüssel aus Server und Scope, siehe `dhcpScopeKey` */
    scope: string;
    hardwareAddress: string;
    ipAddress: string;
    hostName: string;
    comments: string;
  }

  interface Props {
    open: boolean;
    scopes: DhcpScope[];
    /** Vorbelegung beim Anlegen, z. B. aus einer Lease */
    initial?: Partial<ReservationValues> | null;
    /** Bestehende Reservierung beim Bearbeiten */
    existing?: (DhcpReservation & { scope: string; server: string }) | null;
    onclose: () => void;
    onsubmit: (values: ReservationValues) => Promise<void>;
  }

  let { open, scopes, initial = null, existing = null, onclose, onsubmit }: Props = $props();

  let values = $state<ReservationValues>({
    scope: '',
    hardwareAddress: '',
    ipAddress: '',
    hostName: '',
    comments: '',
  });
  let errors = $state<Record<string, string>>({});
  let general = $state<string | null>(null);
  let busy = $state(false);

  const editing = $derived(existing !== null);
  const scope = $derived(scopes.find((s) => dhcpScopeKey(s) === values.scope));
  const multi = $derived(multipleDhcpServers(scopes));
  // Nur ein Hinweis: Technitium entscheidet, ob die Adresse passt.
  const outsideRange = $derived(
    !!scope &&
      /^\d+\.\d+\.\d+\.\d+$/.test(values.ipAddress) &&
      !ipv4InRange(values.ipAddress, scope.startingAddress, scope.endingAddress),
  );

  $effect(() => {
    if (!open) return;
    errors = {};
    general = null;
    values = existing
      ? {
          scope: dhcpScopeKey({ server: existing.server, name: existing.scope }),
          hardwareAddress: existing.hardwareAddress,
          ipAddress: existing.address,
          hostName: existing.hostName ?? '',
          comments: existing.comments ?? '',
        }
      : {
          scope: initial?.scope ?? (scopes[0] ? dhcpScopeKey(scopes[0]) : ''),
          hardwareAddress: initial?.hardwareAddress ?? '',
          ipAddress: initial?.ipAddress ?? '',
          hostName: initial?.hostName ?? '',
          comments: initial?.comments ?? '',
        };
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    errors = {};
    general = null;
    try {
      await onsubmit({ ...values });
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        errors = Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
      } else general = error instanceof Error ? error.message : 'Speichern fehlgeschlagen';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title={editing ? 'Reservierung bearbeiten' : 'Neue Reservierung'}>
  <form id="reservation-form" class="grid gap-4" onsubmit={submit} novalidate>
    {#if general}
      <p class="rounded-lg bg-down/10 px-3 py-2 text-sm text-down" role="alert">{general}</p>
    {/if}

    <div>
      <label class="field-label" for="res-scope">Scope</label>
      <select id="res-scope" class="input" bind:value={values.scope} disabled={editing}>
        {#each scopes as s (dhcpScopeKey(s))}
          <option value={dhcpScopeKey(s)}
            >{s.name} ({s.startingAddress} – {s.endingAddress}){multi
              ? ` · ${s.serverName}`
              : ''}</option
          >
        {/each}
      </select>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="res-mac">MAC-Adresse</label>
        <input
          id="res-mac"
          class="input font-mono"
          bind:value={values.hardwareAddress}
          placeholder="00-1A-2B-3C-4D-5E"
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.hardwareAddress}
          aria-describedby={errors.hardwareAddress ? 'res-mac-err' : undefined}
        />
        {#if errors.hardwareAddress}<p id="res-mac-err" class="field-error">
            {errors.hardwareAddress}
          </p>{/if}
      </div>
      <div>
        <label class="field-label" for="res-ip">IP-Adresse</label>
        <input
          id="res-ip"
          class="input font-mono"
          bind:value={values.ipAddress}
          placeholder={scope ? scope.startingAddress.replace(/\.\d+$/, '.50') : '10.10.10.50'}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={!!errors.ipAddress}
          aria-describedby="res-ip-hint{errors.ipAddress ? ' res-ip-err' : ''}"
        />
        {#if errors.ipAddress}<p id="res-ip-err" class="field-error">{errors.ipAddress}</p>{/if}
        <p id="res-ip-hint" class="field-hint" class:text-down={outsideRange}>
          {#if outsideRange}Liegt außerhalb des Bereichs dieses Scopes.{:else}Muss im Bereich des
            Scopes liegen.{/if}
        </p>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="field-label" for="res-host">Hostname</label>
        <input
          id="res-host"
          class="input font-mono"
          bind:value={values.hostName}
          placeholder="optional"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          aria-invalid={!!errors.hostName}
        />
        {#if errors.hostName}<p class="field-error">{errors.hostName}</p>{/if}
      </div>
      <div>
        <label class="field-label" for="res-comment">Kommentar</label>
        <input
          id="res-comment"
          class="input"
          bind:value={values.comments}
          maxlength="200"
          placeholder="optional"
          aria-invalid={!!errors.comments}
        />
        {#if errors.comments}<p class="field-error">{errors.comments}</p>{/if}
      </div>
    </div>
  </form>

  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button type="submit" form="reservation-form" class="btn btn-primary" disabled={busy}>
      {busy ? 'Speichert …' : 'Speichern'}
    </button>
  {/snippet}
</Dialog>

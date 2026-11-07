<script lang="ts">
  import {
    dhcpScopeKey,
    multipleDhcpServers,
    parseDhcpScopeKey,
    ipv4InRange,
    ipv4ToInt,
    parseCidr,
    type DhcpScope,
    type IpamIpDetail,
    type IpamNetwork,
  } from '@ultimate-dash/shared';
  import { api, ApiError } from '$lib/api';
  import { fullName } from '$lib/dns-records';
  import { toasts } from '$lib/toasts.svelte';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    network: IpamNetwork;
    /** Vorgeschlagene Adresse (angeklickter Block oder erste freie) */
    address: string;
    onclose: () => void;
    /** Nach dem Anlegen; bekommt die neue Adresse. */
    ondone: (address: string) => void;
  }
  let { open, network, address: initialAddress, onclose, ondone }: Props = $props();

  type Kind = 'reservation' | 'static';

  let address = $state('');
  let kind = $state<Kind>('reservation');
  /** Schlüssel aus Server und Scope, siehe `dhcpScopeKey` */
  let scope = $state('');
  let mac = $state('');
  let hostName = $state('');
  let comments = $state('');
  let dns = $state(true);
  let zone = $state('');
  let ttl = $state('3600');
  let createPtr = $state(true);
  let confirmUsed = $state(false);

  let scopes = $state<DhcpScope[]>([]);
  let zones = $state<string[]>([]);
  let existing = $state<IpamIpDetail | null>(null);
  let checking = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});
  let busy = $state(false);

  const cidr = $derived(parseCidr(network.cidr));
  const addressValid = $derived.by(() => {
    const n = ipv4ToInt(address.trim());
    return !!cidr && n !== null && n > cidr.first && n < cidr.last;
  });

  const poolScope = $derived(
    addressValid
      ? scopes.find(
          (s) =>
            ipv4InRange(address.trim(), s.startingAddress, s.endingAddress) &&
            !s.exclusions.some((x) =>
              ipv4InRange(address.trim(), x.startingAddress, x.endingAddress),
            ),
        )
      : undefined,
  );
  const networkScopes = $derived(
    scopes.filter((s) => {
      const n = ipv4ToInt(s.startingAddress);
      return !!cidr && n !== null && n >= cidr.first && n <= cidr.last;
    }),
  );
  const scopeOptions = $derived(networkScopes.length > 0 ? networkScopes : scopes);
  const multi = $derived(multipleDhcpServers(scopes));
  const chosenScope = $derived(scopes.find((s) => dhcpScopeKey(s) === scope));

  // Beim Öffnen alles zurücksetzen und Scopes/Zonen laden.
  $effect(() => {
    if (!open) return;
    address = initialAddress;
    kind = 'reservation';
    mac = '';
    hostName = '';
    comments = '';
    dns = true;
    ttl = '3600';
    createPtr = true;
    confirmUsed = false;
    error = null;
    fieldErrors = {};
    existing = null;
    void Promise.all([api.dhcpScopes(), api.dnsZones()])
      .then(([s, z]) => {
        scopes = s;
        zones = z
          .filter(
            (x) =>
              !x.internal && !x.disabled && !x.name.endsWith('.arpa') && /^Primary$/i.test(x.type),
          )
          .map((x) => x.name);
      })
      .catch((e) => (error = e instanceof Error ? e.message : 'Technitium nicht erreichbar'));
  });

  // Scope und Zone sinnvoll vorbelegen, sobald die Daten da sind.
  $effect(() => {
    if (!open) return;
    if (!scope || !scopeOptions.some((s) => dhcpScopeKey(s) === scope)) {
      const first = poolScope ?? scopeOptions[0];
      scope = first ? dhcpScopeKey(first) : '';
    }
  });
  $effect(() => {
    if (!open) return;
    const domain = chosenScope?.domainName ?? null;
    if (!zone || !zones.includes(zone))
      zone = domain && zones.includes(domain) ? domain : (zones[0] ?? '');
  });

  // Ist die Adresse schon belegt? (Lease, DNS, Ping)
  $effect(() => {
    if (!open || !addressValid) {
      existing = null;
      checking = false;
      return;
    }
    const current = address.trim();
    checking = true;
    let stale = false;
    const timer = setTimeout(() => {
      api
        .ipamIp(current)
        .then((d) => {
          if (!stale) existing = d;
        })
        .catch(() => {
          if (!stale) existing = null;
        })
        .finally(() => {
          if (!stale) checking = false;
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });
  $effect(() => {
    void address;
    confirmUsed = false;
  });
  $effect(() => {
    if (kind === 'static') dns = true;
  });

  const used = $derived(existing?.state === 'used' || existing?.alive === true);
  const staticInPool = $derived(kind === 'static' && !!poolScope);
  const dnsName = $derived(hostName.trim() && zone ? fullName(hostName, zone) : '');

  const steps = $derived.by(() => {
    const list: string[] = [];
    if (kind === 'reservation')
      list.push(
        `DHCP-Reservierung ${address.trim()} für ${mac.trim() || '(MAC fehlt)'} in „${chosenScope?.name ?? ''}“${hostName.trim() ? ` (Hostname ${hostName.trim()})` : ''}`,
      );
    if (dns && dnsName) {
      list.push(`DNS: A-Eintrag ${dnsName} → ${address.trim()} (TTL ${ttl})`);
      if (createPtr) list.push('DNS: passender PTR-Eintrag');
    }
    return list;
  });

  const problem = $derived.by(() => {
    if (!addressValid) return 'Die Adresse muss eine Host-Adresse im Netz sein.';
    if (kind === 'reservation' && !scope) return 'Es gibt keinen DHCP-Scope.';
    if (kind === 'reservation' && !mac.trim()) return 'Die MAC-Adresse fehlt.';
    if (kind === 'static' && !(dns && dnsName)) return 'Eine statische IP braucht einen DNS-Namen.';
    if (dns && !hostName.trim()) return 'Für den DNS-Eintrag fehlt der Hostname.';
    if (dns && !zone) return 'Es gibt keine DNS-Zone.';
    if (used && !confirmUsed) return 'Die Adresse ist schon belegt. Bitte bestätigen.';
    return null;
  });

  /** Reservierung, dann DNS; schlägt DNS fehl, wird die Reservierung wieder entfernt. */
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (problem) return;
    busy = true;
    error = null;
    fieldErrors = {};
    const ip = address.trim();
    let reserved = false;
    try {
      if (kind === 'reservation') {
        await api.addDhcpReservation({
          ...parseDhcpScopeKey(scope),
          hardwareAddress: mac,
          ipAddress: ip,
          hostName,
          comments,
        });
        reserved = true;
      }
      if (dns && dnsName) {
        await api.addDnsRecord({
          zone,
          domain: dnsName,
          ttl: Number(ttl),
          comments: '',
          createPtr,
          data: { type: 'A', ipAddress: ip },
        });
      }
      toasts.show(`${ip} angelegt`);
      ondone(ip);
    } catch (e) {
      let message = e instanceof Error ? e.message : 'Anlegen fehlgeschlagen';
      if (e instanceof ApiError && e.issues.length > 0) fieldErrors = e.fieldErrors();
      if (reserved) {
        const undone = await api
          .deleteDhcpReservation({ ...parseDhcpScopeKey(scope), hardwareAddress: mac })
          .then(() => true)
          .catch(() => false);
        message += undone
          ? ' – die Reservierung wurde zurückgenommen.'
          : ' – die Reservierung konnte nicht zurückgenommen werden, bitte in der Liste prüfen.';
      }
      error = message;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} {onclose} title="Neue IP anlegen">
  <form id="ip-wizard" class="grid gap-4 text-sm" onsubmit={submit}>
    <p class="text-fg-muted">
      Pro Vorgang wird genau eine Adresse in „{network.name}“ angelegt. Alle Schritte werden
      protokolliert; schlägt einer fehl, wird die Reservierung zurückgenommen.
    </p>

    <label class="grid gap-1">
      <span class="font-medium">Adresse</span>
      <input class="field font-mono" bind:value={address} autocomplete="off" inputmode="decimal" />
    </label>
    {#if address.trim() && !addressValid}
      <p class="text-down" role="alert">Das ist keine Host-Adresse in {network.cidr}.</p>
    {/if}
    {#if used}
      <div class="grid gap-2 rounded-xl border border-down/40 p-3" role="alert">
        <p class="text-down">
          Diese Adresse ist schon belegt{existing?.type
            ? ` (${{ reservation: 'Reservierung', lease: 'Lease', static: 'statisch' }[existing.type]})`
            : ''}{existing?.alive ? ' und antwortet auf Ping' : ''}.
        </p>
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={confirmUsed} />
          Trotzdem fortfahren
        </label>
      </div>
    {/if}

    <fieldset class="grid gap-2">
      <legend class="mb-1 font-medium">Art</legend>
      <label class="flex items-start gap-2">
        <input type="radio" bind:group={kind} value="reservation" class="mt-0.5" />
        <span
          >DHCP-Reservierung
          <span class="block text-xs text-fg-muted"
            >Das Gerät bekommt diese Adresse immer vom DHCP-Server (braucht die MAC).</span
          ></span
        >
      </label>
      <label class="flex items-start gap-2">
        <input type="radio" bind:group={kind} value="static" class="mt-0.5" />
        <span
          >Statisch
          <span class="block text-xs text-fg-muted"
            >Das Gerät ist von Hand eingestellt; in Technitium entsteht nur der DNS-Eintrag.</span
          ></span
        >
      </label>
    </fieldset>
    {#if staticInPool}
      <p class="rounded-xl border border-line p-3 text-fg-muted" role="note">
        Achtung: Die Adresse liegt im DHCP-Bereich von „{poolScope?.name}“. Der Server könnte sie
        sonst an ein anderes Gerät vergeben. Das Anlegen ist trotzdem möglich.
      </p>
    {:else if kind === 'reservation' && poolScope}
      <p class="text-xs text-fg-muted">Die Adresse liegt im Pool von „{poolScope.name}“.</p>
    {/if}

    {#if kind === 'reservation'}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1">
          <span class="font-medium">Scope</span>
          <select class="field" bind:value={scope}>
            {#each scopeOptions as s (dhcpScopeKey(s))}<option value={dhcpScopeKey(s)}
                >{s.name}{multi ? ` · ${s.serverName}` : ''}</option
              >{/each}
          </select>
        </label>
        <label class="grid gap-1">
          <span class="font-medium">MAC-Adresse</span>
          <input
            class="field font-mono"
            bind:value={mac}
            placeholder="AA-BB-CC-DD-EE-FF"
            autocomplete="off"
          />
          {#if fieldErrors.hardwareAddress}<span class="text-xs text-down"
              >{fieldErrors.hardwareAddress}</span
            >{/if}
        </label>
      </div>
    {/if}
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1">
        <span class="font-medium">Hostname</span>
        <input class="field" bind:value={hostName} autocomplete="off" />
        {#if fieldErrors.hostName}<span class="text-xs text-down">{fieldErrors.hostName}</span>{/if}
      </label>
      {#if kind === 'reservation'}
        <label class="grid gap-1">
          <span class="font-medium">Kommentar</span>
          <input class="field" bind:value={comments} autocomplete="off" />
        </label>
      {/if}
    </div>

    <div class="grid gap-2 rounded-xl border border-line p-3">
      <label class="flex items-center gap-2">
        <input type="checkbox" bind:checked={dns} disabled={kind === 'static'} />
        <span class="font-medium">DNS-Eintrag (A) anlegen</span>
      </label>
      {#if dns}
        <div class="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <label class="grid gap-1">
            <span class="text-fg-muted">Zone</span>
            <select class="field" bind:value={zone}>
              {#each zones as z (z)}<option value={z}>{z}</option>{/each}
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-fg-muted">TTL</span>
            <input class="field" bind:value={ttl} inputmode="numeric" />
          </label>
        </div>
        <p class="text-fg-muted">
          Name: <span class="font-mono">{dnsName || '–'}</span>
        </p>
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={createPtr} />
          PTR-Eintrag mit anlegen
        </label>
      {/if}
    </div>

    <section class="grid gap-1 rounded-xl bg-muted p-3" aria-label="Zusammenfassung">
      <h3 class="text-xs font-semibold tracking-wide text-fg-muted uppercase">Das passiert</h3>
      {#if steps.length > 0}
        <ol class="list-decimal pl-5">
          {#each steps as step (step)}<li>{step}</li>{/each}
        </ol>
      {:else}
        <p class="text-fg-muted">Noch nichts ausgewählt.</p>
      {/if}
    </section>

    {#if error}<p class="text-down" role="alert">{error}</p>{/if}
    {#if problem && address.trim() && !error && !(used && !confirmUsed)}<p
        class="text-xs text-fg-muted"
      >
        {problem}
      </p>{/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onclose}>Abbrechen</button>
    <button
      type="submit"
      form="ip-wizard"
      class="btn btn-primary"
      disabled={busy || checking || !!problem}
    >
      {busy ? 'Legt an …' : 'Anlegen'}
    </button>
  {/snippet}
</Dialog>

import {
  ipv4ToInt,
  parseCidr,
  type DhcpLease,
  type DhcpScope,
  type DnsRecordList,
  type DnsZone,
  type IpamAddressUsage,
  type IpamClaim,
  type IpamData,
  type IpamNetworkUsage,
  type IpamUsage,
} from '@ultimate-dash/shared';
import { TechnitiumError } from '../technitium/client.js';

/** Was die Belegungsberechnung von Technitium braucht (zum Testen austauschbar). */
export interface UsageSources {
  scopes(): Promise<DhcpScope[]>;
  leases(): Promise<DhcpLease[]>;
  zones(): Promise<DnsZone[]>;
  records(zone: string): Promise<DnsRecordList>;
}

interface Snapshot {
  scopes: DhcpScope[];
  claims: Map<number, IpamClaim[]>;
}

const CACHE_MS = 15_000;
const sameMac = (a: string | null, b: string | null) =>
  a !== null &&
  b !== null &&
  a.replace(/[:-]/g, '').toLowerCase() === b.replace(/[:-]/g, '').toLowerCase();

/** Reverse-Zonen enthalten PTR, Forwarder-/Stub-Zonen keine eigenen Einträge. */
const holdsAddresses = (zone: DnsZone) =>
  !zone.internal &&
  !zone.disabled &&
  !zone.name.endsWith('.arpa') &&
  /^(Primary|Secondary)$/i.test(zone.type);

export class IpamUsageService {
  private cache: { at: number; snapshot: Snapshot } | null = null;
  private pending: Promise<Snapshot> | null = null;

  constructor(private readonly sources: UsageSources) {}

  private load(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return Promise.resolve(this.cache.snapshot);
    this.pending ??= this.fetch()
      .then((snapshot) => {
        this.cache = { at: Date.now(), snapshot };
        return snapshot;
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetch(): Promise<Snapshot> {
    const [scopes, leases, zones] = await Promise.all([
      this.sources.scopes(),
      this.sources.leases(),
      this.sources.zones(),
    ]);
    const claims = new Map<number, IpamClaim[]>();
    const add = (address: string, claim: IpamClaim) => {
      const key = ipv4ToInt(address);
      if (key === null) return;
      const list = claims.get(key) ?? [];
      if (
        !list.some(
          (c) => c.source === claim.source && c.name === claim.name && sameMac(c.mac, claim.mac),
        )
      )
        list.push(claim);
      claims.set(key, list);
    };

    for (const scope of scopes)
      for (const r of scope.reservations)
        add(r.address, {
          source: 'reservation',
          mac: r.hardwareAddress,
          name: r.hostName,
          scope: scope.name,
        });
    for (const lease of leases) {
      const scope = scopes.find((s) => s.name === lease.scope);
      // Reservierte Leases sind schon als Reservierung erfasst.
      if (
        lease.type === 'Reserved' &&
        scope?.reservations.some(
          (r) => sameMac(r.hardwareAddress, lease.hardwareAddress) && r.address === lease.address,
        )
      )
        continue;
      add(lease.address, {
        source: 'lease',
        mac: lease.hardwareAddress,
        name: lease.hostName,
        scope: lease.scope,
      });
    }

    // Ein Zonenfehler soll nicht die ganze Belegung verhindern.
    const lists = await Promise.all(
      zones.filter(holdsAddresses).map((zone) => this.sources.records(zone.name).catch(() => null)),
    );
    for (const list of lists)
      for (const record of list?.records ?? [])
        if (record.type === 'A' && !record.disabled && record.data?.type === 'A')
          add(record.data.ipAddress, {
            source: 'dns',
            mac: null,
            name: record.domain,
            scope: null,
          });

    return { scopes, claims };
  }

  async usage(data: IpamData): Promise<IpamUsage> {
    if (data.networks.length === 0) return { available: true, reason: null, networks: {} };
    let snapshot: Snapshot;
    try {
      snapshot = await this.load();
    } catch (error) {
      const reason =
        error instanceof TechnitiumError && error.kind === 'not-configured'
          ? 'Technitium ist nicht verbunden.'
          : error instanceof Error
            ? error.message
            : 'Technitium nicht erreichbar';
      return { available: false, reason, networks: {} };
    }

    const networks: Record<number, IpamNetworkUsage> = {};
    for (const network of data.networks) {
      const cidr = parseCidr(network.cidr)!;
      const firstHost = cidr.first + 1;
      const lastHost = cidr.last - 1;
      const ranges = data.ranges
        .filter((r) => r.networkId === network.id)
        .map((r) => ({ id: r.id, s: ipv4ToInt(r.startAddress)!, e: ipv4ToInt(r.endAddress)! }));

      const addresses: IpamAddressUsage[] = [];
      const rangeUse: IpamNetworkUsage['rangeUse'] = Object.fromEntries(
        ranges.map((r) => [r.id, { size: r.e - r.s + 1, used: 0 }]),
      );
      let unassignedUsed = 0;
      let conflicts = 0;
      for (const [ip, claims] of snapshot.claims) {
        if (ip < firstHost || ip > lastHost) continue;
        const macs = new Set(
          claims.map((c) => c.mac?.replace(/[:-]/g, '').toLowerCase()).filter(Boolean),
        );
        const conflict = macs.size > 1;
        if (conflict) conflicts++;
        addresses.push({ address: intToString(ip), claims, conflict });
        const range = ranges.find((r) => ip >= r.s && ip <= r.e);
        if (range) rangeUse[range.id]!.used++;
        else unassignedUsed++;
      }
      addresses.sort((a, b) => ipv4ToInt(a.address)! - ipv4ToInt(b.address)!);

      networks[network.id] = {
        networkId: network.id,
        hosts: cidr.size - 2,
        used: addresses.length,
        pools: snapshot.scopes
          .filter((s) => {
            const a = ipv4ToInt(s.startingAddress);
            const b = ipv4ToInt(s.endingAddress);
            return a !== null && b !== null && a <= cidr.last && b >= cidr.first;
          })
          .map((s) => ({
            scope: s.name,
            enabled: s.enabled,
            start: s.startingAddress,
            end: s.endingAddress,
            exclusions: s.exclusions.map((x) => ({
              start: x.startingAddress,
              end: x.endingAddress,
            })),
          })),
        addresses,
        rangeUse,
        unassignedUsed,
        conflicts,
      };
    }
    return { available: true, reason: null, networks };
  }
}

function intToString(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

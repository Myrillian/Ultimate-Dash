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
  type IpamIpDetail,
  type IpamNetworkUsage,
  type IpamUsage,
} from '@ultimate-dash/shared';
import { TechnitiumError } from '../technitium/client.js';
import type { HostRow } from './hosts.js';

/** Was die Belegungsberechnung von Technitium braucht (zum Testen austauschbar). */
export interface UsageSources {
  scopes(): Promise<DhcpScope[]>;
  leases(): Promise<DhcpLease[]>;
  zones(): Promise<DnsZone[]>;
  records(zone: string): Promise<DnsRecordList>;
}

interface Snapshot {
  scopes: DhcpScope[];
  leases: DhcpLease[];
  zones: DnsZone[];
  claims: Map<number, IpamClaim[]>;
  /** A-Einträge je Adresse */
  forward: Map<number, { zone: string; domain: string; ttl: number; comment: string | null }[]>;
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
  private generation = 0;

  constructor(
    private readonly sources: UsageSources,
    private readonly hosts: () => HostRow[] = () => [],
  ) {}

  /** Verwirft den Zwischenspeicher, z. B. nach einer Änderung in Technitium. */
  invalidate(): void {
    this.cache = null;
    this.generation++;
    this.pending = null;
  }

  private load(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return Promise.resolve(this.cache.snapshot);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const request = this.fetch()
      .then((snapshot) => {
        // Ein Abruf, der vor einer Änderung begann, darf den Zwischenspeicher nicht mehr füllen.
        if (generation === this.generation) this.cache = { at: Date.now(), snapshot };
        return snapshot;
      })
      .finally(() => {
        if (this.pending === request) this.pending = null;
      });
    this.pending = request;
    return request;
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
          hostId: null,
        });
    for (const lease of leases) {
      const scope = scopes.find((s) => s.server === lease.server && s.name === lease.scope);
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
        hostId: null,
      });
    }

    // Ein Zonenfehler soll nicht die ganze Belegung verhindern.
    const lists = await Promise.all(
      zones.filter(holdsAddresses).map((zone) => this.sources.records(zone.name).catch(() => null)),
    );
    const forward: Snapshot['forward'] = new Map();
    for (const list of lists)
      for (const record of list?.records ?? [])
        if (record.type === 'A' && !record.disabled && record.data?.type === 'A') {
          add(record.data.ipAddress, {
            source: 'dns',
            mac: null,
            name: record.domain,
            scope: null,
            hostId: null,
          });
          const key = ipv4ToInt(record.data.ipAddress);
          if (key !== null)
            forward.set(key, [
              ...(forward.get(key) ?? []),
              {
                zone: list!.zone.name,
                domain: record.domain,
                ttl: record.ttl,
                comment: record.comments,
              },
            ]);
        }

    return { scopes, leases, zones, claims, forward };
  }

  /**
   * Alles zu einer Adresse für das Seitenfenster. Die Adresse muss in einem Netz liegen,
   * sonst `null`. Wirft bei Technitium-Fehlern wie `usage` nicht, sondern meldet sie als Fehler.
   */
  async detail(data: IpamData, address: string): Promise<IpamIpDetail | null> {
    const ip = ipv4ToInt(address);
    if (ip === null) return null;
    const network = data.networks.find((n) => {
      const cidr = parseCidr(n.cidr)!;
      return ip > cidr.first && ip < cidr.last;
    });
    if (!network) return null;
    const snapshot = await this.load();

    const host = this.hosts().find((h) => ipv4ToInt(h.address) === ip);
    const known = snapshot.claims.get(ip) ?? [];
    const isDiscovered = !!host && !host.acknowledged && known.length === 0;
    const claims = [...known];
    if (host && (host.acknowledged || known.length === 0))
      claims.push({
        source: host.acknowledged ? 'manual' : 'discovered',
        mac: null,
        name: host.name,
        scope: null,
        hostId: host.id,
      });
    const macs = new Set(
      claims.map((c) => c.mac?.replace(/[:-]/g, '').toLowerCase()).filter(Boolean),
    );
    const scanned = network.scan && network.lastScanAt !== null;
    const range = data.ranges.find(
      (r) =>
        r.networkId === network.id &&
        ip >= ipv4ToInt(r.startAddress)! &&
        ip <= ipv4ToInt(r.endAddress)!,
    );

    // DHCP
    const scope = snapshot.scopes.find((s) => {
      const a = ipv4ToInt(s.startingAddress);
      const b = ipv4ToInt(s.endingAddress);
      return a !== null && b !== null && ip >= a && ip <= b;
    });
    const reservationScope = snapshot.scopes.find((s) =>
      s.reservations.some((r) => ipv4ToInt(r.address) === ip),
    );
    const reservation = reservationScope?.reservations.find((r) => ipv4ToInt(r.address) === ip);
    const lease = snapshot.leases.find(
      (l) => ipv4ToInt(l.address) === ip && !(l.type === 'Reserved' && reservation),
    );

    // DNS: Reverse-Zone mit dem längsten passenden Namen
    const ptrName = `${address.split('.').reverse().join('.')}.in-addr.arpa`;
    const reverseZone = snapshot.zones
      .filter((z) => !z.disabled && ptrName.endsWith(`.${z.name.toLowerCase()}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    let reverse: IpamIpDetail['dns']['reverse'] = null;
    if (reverseZone) {
      const list = await this.sources.records(reverseZone.name).catch(() => null);
      const ptr = list?.records.find(
        (r) => r.type === 'PTR' && r.domain.toLowerCase() === ptrName && !r.disabled,
      );
      if (ptr)
        reverse = { zone: reverseZone.name, domain: ptr.domain, target: ptr.display, ttl: ptr.ttl };
    }

    const type: IpamIpDetail['type'] =
      claims.length === 0
        ? null
        : claims.some((c) => c.source === 'reservation')
          ? 'reservation'
          : claims.some((c) => c.source === 'lease')
            ? 'lease'
            : 'static';
    return {
      address,
      networkId: network.id,
      rangeId: range?.id ?? null,
      categoryId: range?.categoryId ?? null,
      state: claims.length === 0 ? 'free' : 'used',
      type,
      discovered: isDiscovered,
      conflict: macs.size > 1,
      alive: host ? host.alive : scanned ? false : null,
      lastSeen: host?.lastSeenAt ?? null,
      hostId: host?.id ?? null,
      hostName: host?.name ?? null,
      dhcp: {
        pool: scope
          ? {
              server: scope.server,
              scope: scope.name,
              enabled: scope.enabled,
              excluded: scope.exclusions.some((x) => {
                const a = ipv4ToInt(x.startingAddress);
                const b = ipv4ToInt(x.endingAddress);
                return a !== null && b !== null && ip >= a && ip <= b;
              }),
            }
          : null,
        reservation:
          reservation && reservationScope
            ? {
                server: reservationScope.server,
                scope: reservationScope.name,
                mac: reservation.hardwareAddress,
                hostName: reservation.hostName,
                comment: reservation.comments,
              }
            : null,
        lease: lease
          ? {
              server: lease.server,
              scope: lease.scope,
              mac: lease.hardwareAddress,
              hostName: lease.hostName,
              obtained: lease.obtained,
              expires: lease.expires,
            }
          : null,
      },
      dns: {
        forward: snapshot.forward.get(ip) ?? [],
        reverse,
        reverseZone: reverseZone?.name ?? null,
      },
    };
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

    const hostRows = new Map(this.hosts().map((h) => [ipv4ToInt(h.address)!, h]));
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
      let discovered = 0;
      let online = 0;
      const scanned = network.scan && network.lastScanAt !== null;

      // Technitium-Quellen und per Ping gefundene Geräte zusammenführen.
      const ips = new Set<number>();
      for (const ip of snapshot.claims.keys()) ips.add(ip);
      for (const [ip, host] of hostRows) if (host.acknowledged || host.alive) ips.add(ip);

      for (const ip of ips) {
        if (ip < firstHost || ip > lastHost) continue;
        const host = hostRows.get(ip);
        const known = snapshot.claims.get(ip) ?? [];
        const claims = [...known];
        let isDiscovered = false;
        if (host && (host.acknowledged || known.length === 0)) {
          isDiscovered = !host.acknowledged;
          claims.push({
            source: host.acknowledged ? 'manual' : 'discovered',
            mac: null,
            name: host.name,
            scope: null,
            hostId: host.id,
          });
        }
        const macs = new Set(
          claims.map((c) => c.mac?.replace(/[:-]/g, '').toLowerCase()).filter(Boolean),
        );
        const conflict = macs.size > 1;
        if (conflict) conflicts++;
        const alive = host ? host.alive : scanned ? false : null;
        if (alive) online++;
        if (isDiscovered) discovered++;
        addresses.push({
          address: intToString(ip),
          claims,
          type: claims.some((c) => c.source === 'reservation')
            ? 'reservation'
            : claims.some((c) => c.source === 'lease')
              ? 'lease'
              : 'static',
          conflict,
          alive,
          lastSeen: host?.lastSeenAt ?? null,
          discovered: isDiscovered,
        });
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
        discovered,
        online,
        lastScanAt: network.scan ? network.lastScanAt : null,
      };
    }
    return { available: true, reason: null, networks };
  }
}

function intToString(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

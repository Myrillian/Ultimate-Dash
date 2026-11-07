import { describe, expect, it } from 'vitest';
import type { IpamAddressUsage, IpamClaim } from './ipam.js';
import {
  ipamAddressFlags,
  ipamNetworkStats,
  ipamPoolIntervals,
  sumIpamStats,
} from './ipam-stats.js';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const claim = (source: IpamClaim['source']): IpamClaim => ({
  source,
  mac: null,
  name: null,
  scope: null,
  hostId: null,
});
const addr = (address: string, extra: Partial<IpamAddressUsage> = {}): IpamAddressUsage => ({
  address,
  claims: [claim('dns')],
  type: 'static',
  alive: null,
  lastSeen: null,
  discovered: false,
  conflict: false,
  firstSeen: null,
  leaseExpires: null,
  ptr: null,
  ...extra,
});

describe('Merkmale einer Adresse', () => {
  it('erkennt neu, lange nicht gesehen und bald ablaufende Leases', () => {
    expect(ipamAddressFlags(addr('10.0.0.1', { firstSeen: daysAgo(2) }), NOW)).toEqual(['recent']);
    expect(ipamAddressFlags(addr('10.0.0.1', { firstSeen: daysAgo(8) }), NOW)).toEqual([]);
    expect(
      ipamAddressFlags(addr('10.0.0.1', { alive: false, lastSeen: daysAgo(31) }), NOW),
    ).toEqual(['stale']);
    // Antwortet gerade: nicht „lange nicht gesehen“, auch wenn der Zeitstempel alt wäre
    expect(ipamAddressFlags(addr('10.0.0.1', { alive: true, lastSeen: daysAgo(31) }), NOW)).toEqual(
      [],
    );
    const soon = new Date(NOW + 3_600_000).toISOString();
    const expired = new Date(NOW - 3_600_000).toISOString();
    expect(ipamAddressFlags(addr('10.0.0.1', { leaseExpires: soon }), NOW)).toEqual(['expiring']);
    expect(ipamAddressFlags(addr('10.0.0.1', { leaseExpires: expired }), NOW)).toEqual([]);
  });

  it('meldet DNS- und PTR-Lücken, aber nicht bei nur entdeckten Geräten', () => {
    expect(ipamAddressFlags(addr('10.0.0.1', { claims: [claim('lease')] }), NOW)).toEqual([
      'no-dns',
    ]);
    expect(
      ipamAddressFlags(addr('10.0.0.1', { claims: [claim('discovered')], discovered: true }), NOW),
    ).toEqual([]);
    expect(ipamAddressFlags(addr('10.0.0.1', { ptr: false }), NOW)).toEqual(['no-ptr']);
    // Ohne Reverse-Zone ist unbekannt, ob ein PTR fehlt
    expect(ipamAddressFlags(addr('10.0.0.1', { ptr: null }), NOW)).toEqual([]);
  });
});

describe('Pool-Adressen', () => {
  it('zieht Ausschlüsse ab, ignoriert abgeschaltete Pools und bleibt im Netz', () => {
    const pools = [
      {
        scope: 'LAN',
        enabled: true,
        start: '10.0.0.1',
        end: '10.0.0.254',
        exclusions: [{ start: '10.0.0.1', end: '10.0.0.99' }],
      },
      { scope: 'Alt', enabled: false, start: '10.0.0.10', end: '10.0.0.20', exclusions: [] },
    ];
    expect(ipamPoolIntervals('10.0.0.0/24', pools)).toEqual([[167772260, 167772414]]);
    // Pool größer als das Netz wird auf die Hostadressen begrenzt
    const wide = [
      { scope: 'X', enabled: true, start: '10.0.0.0', end: '10.0.1.255', exclusions: [] },
    ];
    expect(ipamPoolIntervals('10.0.0.0/24', wide)).toEqual([[167772161, 167772414]]);
  });
});

describe('Kennzahlen eines Netzes', () => {
  const pools = [
    {
      scope: 'LAN',
      enabled: true,
      start: '10.0.0.100',
      end: '10.0.0.199',
      exclusions: [{ start: '10.0.0.150', end: '10.0.0.199' }],
    },
  ];
  const addresses = [
    addr('10.0.0.10', { type: 'reservation', claims: [claim('reservation')], alive: true }),
    addr('10.0.0.11', { alive: false, lastSeen: daysAgo(40), ptr: false }),
    addr('10.0.0.120', { type: 'lease', claims: [claim('lease')], alive: true, conflict: true }),
    addr('10.0.0.130', {
      claims: [claim('discovered')],
      discovered: true,
      alive: true,
      firstSeen: daysAgo(1),
    }),
  ];

  it('zählt Typen, Pool, Erreichbarkeit und Lücken', () => {
    const s = ipamNetworkStats(
      '10.0.0.0/24',
      { hosts: 254, addresses, pools, lastScanAt: daysAgo(0) },
      NOW,
    );
    expect(s).toMatchObject({
      total: 254,
      used: 4,
      free: 250,
      byType: { reservation: 1, lease: 1, static: 1, discovered: 1 },
      pool: { size: 50, used: 2, free: 48 },
      freeStatic: 202,
      scanned: true,
      online: 3,
      noReply: 1,
      discovered: 1,
      conflicts: 1,
      recent: 1,
      stale: 1,
      noDns: 2,
      noPtr: 1,
    });
  });

  it('ohne Pool und ohne Ping-Prüfung', () => {
    const s = ipamNetworkStats(
      '10.0.0.0/24',
      { hosts: 254, addresses: [addr('10.0.0.5')], pools: [], lastScanAt: null },
      NOW,
    );
    expect(s.pool).toBeNull();
    expect(s.freeStatic).toBe(253);
    expect(s.scanned).toBe(false);
  });

  it('summiert mehrere Netze', () => {
    const a = ipamNetworkStats(
      '10.0.0.0/24',
      { hosts: 254, addresses, pools, lastScanAt: null },
      NOW,
    );
    const b = ipamNetworkStats(
      '10.0.1.0/24',
      { hosts: 254, addresses: [], pools: [], lastScanAt: daysAgo(0) },
      NOW,
    );
    const sum = sumIpamStats([a, b]);
    expect(sum).toMatchObject({ total: 508, used: 4, free: 504, scanned: true });
    expect(sum.pool).toEqual({ size: 50, used: 2, free: 48 });
    expect(sum.byType.discovered).toBe(1);
  });
});

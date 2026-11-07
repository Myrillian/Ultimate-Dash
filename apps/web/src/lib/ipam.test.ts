import { describe, expect, it } from 'vitest';
import {
  ipamNetworkStats,
  type IpamCategory,
  type IpamNetwork,
  type IpamNetworkUsage,
  type IpamRange,
} from '@ultimate-dash/shared';
import { buildCells, firstFree } from './ipam';

const network: IpamNetwork = {
  id: 1,
  name: 'LAN',
  cidr: '10.0.0.0/28',
  vlanId: null,
  gateway: '10.0.0.1',
  description: null,
  scan: true,
  lastScanAt: null,
};
const categories: IpamCategory[] = [{ id: 1, name: 'Server', color: 'blue', description: null }];
const ranges: IpamRange[] = [
  {
    id: 1,
    networkId: 1,
    categoryId: 1,
    startAddress: '10.0.0.2',
    endAddress: '10.0.0.5',
    label: null,
  },
];
const base: Omit<IpamNetworkUsage, 'stats'> = {
  networkId: 1,
  hosts: 14,
  used: 3,
  pools: [
    {
      scope: 'LAN',
      enabled: true,
      start: '10.0.0.8',
      end: '10.0.0.12',
      exclusions: [{ start: '10.0.0.8', end: '10.0.0.9' }],
    },
  ],
  addresses: [
    {
      address: '10.0.0.2',
      type: 'static',
      alive: null,
      lastSeen: null,
      discovered: false,
      claims: [{ source: 'dns', mac: null, name: 'a', scope: null, hostId: null }],
      conflict: false,
      firstSeen: null,
      leaseExpires: null,
      ptr: null,
    },
    {
      address: '10.0.0.3',
      type: 'reservation',
      alive: null,
      lastSeen: null,
      discovered: false,
      claims: [{ source: 'reservation', mac: 'AA', name: 'b', scope: 'LAN', hostId: null }],
      conflict: false,
      firstSeen: null,
      leaseExpires: null,
      ptr: null,
    },
    {
      address: '10.0.0.4',
      type: 'lease',
      alive: null,
      lastSeen: null,
      discovered: false,
      claims: [{ source: 'lease', mac: 'AA', name: 'c', scope: 'LAN', hostId: null }],
      conflict: true,
      firstSeen: null,
      leaseExpires: null,
      ptr: null,
    },
  ],
  rangeUse: {},
  unassignedUsed: 0,
  conflicts: 1,
  discovered: 0,
  online: 0,
  lastScanAt: null,
};
const usage: IpamNetworkUsage = { ...base, stats: ipamNetworkStats(network.cidr, base) };

describe('buildCells', () => {
  const cells = buildCells(network, ranges, categories, usage);
  const kind = (ip: string) => cells.find((c) => c.address === ip)!.kind;

  it('liefert eine Zelle je Adresse', () => expect(cells).toHaveLength(16));
  it('markiert Struktur und Belegung', () => {
    expect(kind('10.0.0.0')).toBe('network');
    expect(kind('10.0.0.15')).toBe('broadcast');
    expect(kind('10.0.0.1')).toBe('gateway');
    expect(kind('10.0.0.2')).toBe('static');
    expect(kind('10.0.0.3')).toBe('reserved');
    expect(kind('10.0.0.4')).toBe('conflict');
  });
  it('erkennt freie Adressen im DHCP-Pool ohne Ausschlüsse', () => {
    expect(kind('10.0.0.8')).toBe('free');
    expect(kind('10.0.0.10')).toBe('pool');
    expect(kind('10.0.0.13')).toBe('free');
  });
  it('ordnet die Kategorie über den Bereich zu', () => {
    expect(cells.find((c) => c.address === '10.0.0.3')!.category?.name).toBe('Server');
    expect(cells.find((c) => c.address === '10.0.0.7')!.category).toBeNull();
  });
  it('findet die erste freie Adresse', () => {
    expect(firstFree(cells, ranges[0]!)).toBe('10.0.0.5');
    expect(firstFree(cells, null)).toBe('10.0.0.5');
  });
});

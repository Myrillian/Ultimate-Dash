import { describe, expect, it } from 'vitest';
import type { IpamCategory, IpamNetwork, IpamNetworkUsage, IpamRange } from '@ultimate-dash/shared';
import { buildCells, firstFree } from './ipam';

const network: IpamNetwork = {
  id: 1,
  name: 'LAN',
  cidr: '10.0.0.0/28',
  vlanId: null,
  gateway: '10.0.0.1',
  description: null,
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
const usage: IpamNetworkUsage = {
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
      claims: [{ source: 'dns', mac: null, name: 'a', scope: null }],
      conflict: false,
    },
    {
      address: '10.0.0.3',
      claims: [{ source: 'reservation', mac: 'AA', name: 'b', scope: 'LAN' }],
      conflict: false,
    },
    {
      address: '10.0.0.4',
      claims: [{ source: 'lease', mac: 'AA', name: 'c', scope: 'LAN' }],
      conflict: true,
    },
  ],
  rangeUse: {},
  unassignedUsed: 0,
  conflicts: 1,
};

describe('buildCells', () => {
  const cells = buildCells(network, ranges, categories, usage);
  const kind = (ip: string) => cells.find((c) => c.address === ip)!.kind;

  it('liefert eine Zelle je Adresse', () => expect(cells).toHaveLength(16));
  it('markiert Struktur und Belegung', () => {
    expect(kind('10.0.0.0')).toBe('network');
    expect(kind('10.0.0.15')).toBe('broadcast');
    expect(kind('10.0.0.1')).toBe('gateway');
    expect(kind('10.0.0.2')).toBe('used');
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

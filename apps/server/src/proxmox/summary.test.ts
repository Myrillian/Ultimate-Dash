import { describe, expect, it } from 'vitest';
import { diskRates, summarize, type RawResource } from './summary.js';

const guest = (id: number, read: number, write: number, status = 'running'): RawResource => ({
  id: `qemu/${id}`,
  type: 'qemu',
  vmid: id,
  status,
  diskread: read,
  diskwrite: write,
});

describe('diskRates', () => {
  it('rechnet aus der Differenz Bytes pro Sekunde', () => {
    const first = diskRates([guest(1, 1000, 0)], null, 0);
    expect(first.rates).toBeNull();
    const second = diskRates([guest(1, 11_000, 5000)], first.counters, 10_000);
    expect(second.rates).toEqual({ read: 1000, write: 500 });
  });

  it('wertet zurückgesetzte Zähler und neue Gäste als 0', () => {
    const first = diskRates([guest(1, 50_000, 50_000)], null, 0);
    const second = diskRates([guest(1, 10, 10), guest(2, 9999, 9999)], first.counters, 10_000);
    expect(second.rates).toEqual({ read: 0, write: 0 });
  });
});

describe('summarize', () => {
  it('gewichtet die CPU im Cluster nach Kernen und zählt geteilte Storages einmal', () => {
    const nas = (node: string): RawResource => ({
      id: `storage/${node}/nas`,
      type: 'storage',
      storage: 'nas',
      node,
      status: 'available',
      disk: 10,
      maxdisk: 100,
      shared: 1,
    });
    const s = summarize(
      [
        { id: 'node/a', type: 'node', node: 'a', status: 'online', cpu: 0.5, maxcpu: 4 },
        { id: 'node/b', type: 'node', node: 'b', status: 'online', cpu: 0.1, maxcpu: 12 },
        { id: 'node/c', type: 'node', node: 'c', status: 'offline', cpu: 0, maxcpu: 8 },
        nas('a'),
        nas('b'),
      ],
      new Map(),
      null,
    );
    expect(s.cpu.cores).toBe(16);
    expect(s.cpu.usage).toBeCloseTo(0.2);
    expect(s.storages).toHaveLength(1);
    expect(s.network).toBeNull();
    expect(s.nodes.map((n) => n.online)).toEqual([true, true, false]);
  });
});

describe('diskRates nach langer Pause', () => {
  it('liefert keinen Mittelwert über mehr als zwei Minuten', () => {
    const first = diskRates([guest(1, 0, 0)], null, 0);
    expect(diskRates([guest(1, 1000, 1000)], first.counters, 600_000).rates).toBeNull();
  });
});

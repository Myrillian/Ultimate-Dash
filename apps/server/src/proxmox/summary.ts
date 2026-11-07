import type {
  ProxmoxGuest,
  ProxmoxGuestCount,
  ProxmoxStorage,
  ProxmoxSummary,
} from '@ultimate-dash/shared';

/** Ausschnitt eines Eintrags aus `GET /cluster/resources`, den wir lesen. */
export interface RawResource {
  id: string;
  type: 'node' | 'qemu' | 'lxc' | 'storage' | string;
  node?: string;
  status?: string;
  name?: string;
  vmid?: number;
  template?: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  diskread?: number;
  diskwrite?: number;
  uptime?: number;
  storage?: string;
  plugintype?: string;
  shared?: number;
}

/** Ein Punkt aus `GET /nodes/{node}/rrddata`; fehlende Werte lässt Proxmox weg. */
export interface RawRrdPoint {
  time: number;
  cpu?: number;
  netin?: number;
  netout?: number;
}

/** Zählerstände der Gäste beim letzten Abruf, um daraus den Disk-Durchsatz zu berechnen. */
export interface DiskCounters {
  at: number;
  guests: Map<string, { read: number; write: number }>;
}

/** Längster Abstand zwischen zwei Abrufen, aus dem noch ein Durchsatz berechnet wird. */
const MAX_GAP_SECONDS = 120;

const isGuest = (r: RawResource) => (r.type === 'qemu' || r.type === 'lxc') && !r.template;

function countGuests(resources: RawResource[], type: 'qemu' | 'lxc'): ProxmoxGuestCount {
  const guests = resources.filter((r) => r.type === type && isGuest(r));
  const notRunning: ProxmoxGuest[] = guests
    .filter((r) => r.status !== 'running')
    .map((r) => ({
      id: r.vmid ?? Number(r.id.split('/')[1]),
      name: r.name || `${type === 'qemu' ? 'VM' : 'CT'} ${r.vmid}`,
      status: r.status ?? 'unknown',
    }))
    .sort((a, b) => a.id - b.id);
  return { total: guests.length, running: guests.length - notRunning.length, notRunning };
}

/** Geteilte Storages (NFS, Ceph, …) erscheinen je Knoten einmal, zählen aber nur einmal. */
function storagesOf(resources: RawResource[]): ProxmoxStorage[] {
  const seen = new Map<string, ProxmoxStorage>();
  for (const r of resources) {
    if (r.type !== 'storage' || r.status !== 'available' || !r.maxdisk) continue;
    const name = r.storage ?? r.id.split('/').at(-1)!;
    const shared = r.shared === 1;
    const key = shared ? name : r.id;
    if (seen.has(key)) continue;
    seen.set(key, {
      name,
      type: r.plugintype ?? 'unknown',
      used: r.disk ?? 0,
      total: r.maxdisk,
      shared,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Lese-/Schreibrate aller laufenden Gäste aus der Differenz zum letzten Zählerstand. */
export function diskRates(
  resources: RawResource[],
  previous: DiskCounters | null,
  now: number,
): { rates: { read: number; write: number } | null; counters: DiskCounters } {
  const guests = new Map<string, { read: number; write: number }>();
  for (const r of resources) {
    if (!isGuest(r) || r.status !== 'running') continue;
    guests.set(r.id, { read: r.diskread ?? 0, write: r.diskwrite ?? 0 });
  }
  const counters = { at: now, guests };
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  // Ein Mittelwert über Stunden (niemand hatte das Dashboard offen) wäre irreführend.
  if (!previous || seconds < 1 || seconds > MAX_GAP_SECONDS) return { rates: null, counters };
  let read = 0;
  let write = 0;
  for (const [id, current] of guests) {
    const before = previous.guests.get(id);
    if (!before) continue;
    // Nach einem Neustart beginnen die Zähler bei 0: dann nichts anrechnen.
    read += Math.max(0, current.read - before.read);
    write += Math.max(0, current.write - before.write);
  }
  return { rates: { read: read / seconds, write: write / seconds }, counters };
}

const lastValue = (points: RawRrdPoint[], key: 'netin' | 'netout') => {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i]![key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

export function summarize(
  resources: RawResource[],
  rrd: Map<string, RawRrdPoint[]>,
  diskIo: { read: number; write: number } | null,
  now = new Date(),
): ProxmoxSummary {
  const nodes = resources
    .filter((r) => r.type === 'node')
    .sort((a, b) => (a.node ?? '').localeCompare(b.node ?? ''));
  const online = nodes.filter((n) => n.status === 'online');
  const cores = online.reduce((sum, n) => sum + (n.maxcpu ?? 0), 0);
  // Auslastung im Cluster nach Kernen gewichtet; beim Einzelhost einfach der Wert des Knotens.
  const usage =
    cores > 0 ? online.reduce((sum, n) => sum + (n.cpu ?? 0) * (n.maxcpu ?? 0), 0) / cores : 0;

  let network: { in: number; out: number } | null = null;
  for (const node of online) {
    const points = rrd.get(node.node!) ?? [];
    const netIn = lastValue(points, 'netin');
    const netOut = lastValue(points, 'netout');
    if (netIn === null && netOut === null) continue;
    network ??= { in: 0, out: 0 };
    network.in += netIn ?? 0;
    network.out += netOut ?? 0;
  }

  // Verlauf: Minutenwerte des ersten Knotens als Zeitachse, Werte aller Knoten aufsummiert.
  const base = rrd.get(online[0]?.node ?? '') ?? [];
  const byTime = (name: string) => new Map((rrd.get(name) ?? []).map((p) => [p.time, p]));
  const others = online.slice(1).map((n) => byTime(n.node!));
  const history = {
    times: [] as number[],
    cpu: [] as number[],
    netIn: [] as number[],
    netOut: [] as number[],
  };
  for (const point of base) {
    if (typeof point.cpu !== 'number') continue;
    const all = [point, ...others.map((m) => m.get(point.time))];
    history.times.push(point.time * 1000);
    history.cpu.push(point.cpu);
    history.netIn.push(all.reduce((sum, p) => sum + (p?.netin ?? 0), 0));
    history.netOut.push(all.reduce((sum, p) => sum + (p?.netout ?? 0), 0));
  }

  return {
    fetchedAt: now.toISOString(),
    nodes: nodes.map((n) => ({
      name: n.node ?? n.id,
      online: n.status === 'online',
      uptime: n.uptime ?? 0,
    })),
    cpu: { usage, cores },
    memory: {
      used: online.reduce((sum, n) => sum + (n.mem ?? 0), 0),
      total: online.reduce((sum, n) => sum + (n.maxmem ?? 0), 0),
    },
    network,
    diskIo,
    storages: storagesOf(resources),
    vms: countGuests(resources, 'qemu'),
    containers: countGuests(resources, 'lxc'),
    history,
  };
}

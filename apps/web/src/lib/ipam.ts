import type {
  CategoryColor,
  IpamAddressUsage,
  IpamCategory,
  IpamNetwork,
  IpamNetworkUsage,
  IpamRange,
} from '@ultimate-dash/shared';
import { intToIpv4, ipv4ToInt, parseCidr } from '@ultimate-dash/shared';

export const categoryColor = (color: CategoryColor) => `var(--cat-${color})`;

export const colorNames: Record<CategoryColor, string> = {
  blue: 'Blau',
  orange: 'Orange',
  aqua: 'Türkis',
  yellow: 'Gelb',
  magenta: 'Magenta',
  green: 'Grün',
  violet: 'Violett',
  red: 'Rot',
};

export type CellKind =
  | 'network'
  | 'broadcast'
  | 'gateway'
  | 'conflict'
  | 'reserved'
  | 'used'
  | 'static'
  | 'pool'
  | 'free';

export interface Cell {
  address: string;
  kind: CellKind;
  category: IpamCategory | null;
  range: IpamRange | null;
  usage: IpamAddressUsage | null;
}

/** Ein Eintrag je Adresse des Netzes, in Reihenfolge; Grundlage für das Raster. */
export function buildCells(
  network: IpamNetwork,
  ranges: IpamRange[],
  categories: IpamCategory[],
  usage: IpamNetworkUsage | null,
): Cell[] {
  const cidr = parseCidr(network.cidr);
  if (!cidr) return [];
  const sorted = ranges
    .filter((r) => r.networkId === network.id)
    .map((r) => ({ r, s: ipv4ToInt(r.startAddress)!, e: ipv4ToInt(r.endAddress)! }));
  const used = new Map((usage?.addresses ?? []).map((a) => [ipv4ToInt(a.address)!, a]));
  const gateway = network.gateway ? ipv4ToInt(network.gateway) : null;
  const pools = (usage?.pools ?? [])
    .filter((p) => p.enabled)
    .map((p) => ({
      s: ipv4ToInt(p.start)!,
      e: ipv4ToInt(p.end)!,
      x: p.exclusions.map((x) => [ipv4ToInt(x.start)!, ipv4ToInt(x.end)!] as const),
    }));

  const cells: Cell[] = [];
  for (let n = cidr.first; n <= cidr.last; n++) {
    const hit = sorted.find((x) => n >= x.s && n <= x.e);
    const u = used.get(n) ?? null;
    let kind: CellKind = 'free';
    if (n === cidr.first) kind = 'network';
    else if (n === cidr.last) kind = 'broadcast';
    else if (u?.conflict) kind = 'conflict';
    else if (u)
      kind = u.type === 'reservation' ? 'reserved' : u.type === 'lease' ? 'used' : 'static';
    else if (n === gateway) kind = 'gateway';
    else if (pools.some((p) => n >= p.s && n <= p.e && !p.x.some(([a, b]) => n >= a && n <= b)))
      kind = 'pool';
    cells.push({
      address: intToIpv4(n),
      kind,
      category: hit ? (categories.find((c) => c.id === hit.r.categoryId) ?? null) : null,
      range: hit?.r ?? null,
      usage: u,
    });
  }
  return cells;
}

export const cellKindLabel: Record<CellKind, string> = {
  network: 'Netzadresse',
  broadcast: 'Broadcast',
  gateway: 'Gateway',
  conflict: 'Konflikt',
  reserved: 'Reservierung',
  used: 'Lease',
  static: 'Statisch',
  pool: 'DHCP-Pool (frei)',
  free: 'Frei',
};

/** Erste freie Adresse in einem Bereich: weder belegt noch Netz-/Broadcast-/Gateway-Adresse. */
export function firstFree(cells: Cell[], range: IpamRange | null): string | null {
  const s = range ? ipv4ToInt(range.startAddress)! : -1;
  const e = range ? ipv4ToInt(range.endAddress)! : Infinity;
  for (const cell of cells) {
    const n = ipv4ToInt(cell.address)!;
    if (n < s || n > e) continue;
    if (cell.kind === 'free') return cell.address;
  }
  return null;
}

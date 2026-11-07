import { ipv4ToInt } from './ip.js';
import {
  parseCidr,
  type IpamAddressUsage,
  type IpamNetworkStats,
  type IpamNetworkUsage,
} from './ipam.js';

/** „Neu“: zum ersten Mal per Ping gesehen innerhalb dieser Tage */
export const IPAM_RECENT_DAYS = 7;
/** „Lange nicht gesehen“: letzte Ping-Antwort älter als diese Tage */
export const IPAM_STALE_DAYS = 30;
/** „Läuft bald ab“: dynamische Lease endet innerhalb dieser Stunden */
export const IPAM_EXPIRING_HOURS = 24;
/** Ab dieser Auslastung (Anteil) gilt ein DHCP-Pool als fast voll */
export const IPAM_POOL_WARN = 0.9;

const DAY = 24 * 60 * 60 * 1000;

/** Merkmale einer Adresse, die die Statistik zählt und die Liste filtern kann. */
export type IpamAddressFlag = 'recent' | 'stale' | 'expiring' | 'no-dns' | 'no-ptr';

export const ipamFlagLabels: Record<IpamAddressFlag, string> = {
  recent: `Neu seit ${IPAM_RECENT_DAYS} Tagen`,
  stale: `Über ${IPAM_STALE_DAYS} Tage nicht gesehen`,
  expiring: 'Lease läuft bald ab',
  'no-dns': 'Ohne DNS-Eintrag',
  'no-ptr': 'Ohne PTR',
};

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Welche der Merkmale auf eine belegte Adresse zutreffen. */
export function ipamAddressFlags(a: IpamAddressUsage, now = Date.now()): IpamAddressFlag[] {
  const flags: IpamAddressFlag[] = [];
  const first = time(a.firstSeen);
  if (now - first < IPAM_RECENT_DAYS * DAY) flags.push('recent');
  const last = time(a.lastSeen);
  if (a.alive === false && now - last > IPAM_STALE_DAYS * DAY) flags.push('stale');
  const expires = time(a.leaseExpires) - now;
  if (expires >= 0 && expires < IPAM_EXPIRING_HOURS * 60 * 60 * 1000) flags.push('expiring');
  const hasDns = a.claims.some((c) => c.source === 'dns');
  // Nur entdeckte Geräte haben naturgemäß keinen Eintrag; das zählt „neu entdeckt“ schon.
  if (!hasDns && !a.discovered) flags.push('no-dns');
  if (hasDns && a.ptr === false) flags.push('no-ptr');
  return flags;
}

type UsageInput = Pick<IpamNetworkUsage, 'hosts' | 'addresses' | 'pools' | 'lastScanAt'>;

/** Vereinigung von Bereichen [Anfang, Ende], sortiert und ohne Überlappung. */
function merge(intervals: [number, number][]): [number, number][] {
  const sorted = intervals.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Aktive Pool-Adressen eines Netzes (ohne Ausschlüsse), begrenzt auf die Hostadressen. */
export function ipamPoolIntervals(cidr: string, pools: UsageInput['pools']): [number, number][] {
  const net = parseCidr(cidr);
  if (!net) return [];
  const lo = net.first + 1;
  const hi = net.last - 1;
  const result: [number, number][] = [];
  for (const pool of pools) {
    if (!pool.enabled) continue;
    const s = ipv4ToInt(pool.start);
    const e = ipv4ToInt(pool.end);
    if (s === null || e === null) continue;
    let parts: [number, number][] = [[Math.max(s, lo), Math.min(e, hi)]];
    for (const x of pool.exclusions) {
      const xs = ipv4ToInt(x.start);
      const xe = ipv4ToInt(x.end);
      if (xs === null || xe === null) continue;
      parts = parts.flatMap(([a, b]): [number, number][] =>
        xe < a || xs > b
          ? [[a, b]]
          : ([
              [a, xs - 1],
              [xe + 1, b],
            ].filter(([p, q]) => p! <= q!) as [number, number][]),
      );
    }
    result.push(...parts);
  }
  return merge(result);
}

/** Berechnet die Kennzahlen eines Netzes aus seiner Belegung. */
export function ipamNetworkStats(
  cidr: string,
  usage: UsageInput,
  now = Date.now(),
): IpamNetworkStats {
  const pools = ipamPoolIntervals(cidr, usage.pools);
  const poolSize = pools.reduce((sum, [a, b]) => sum + b - a + 1, 0);
  const inPool = (ip: number) => pools.some(([a, b]) => ip >= a && ip <= b);

  const s: IpamNetworkStats = {
    total: usage.hosts,
    used: usage.addresses.length,
    free: Math.max(0, usage.hosts - usage.addresses.length),
    byType: { reservation: 0, lease: 0, static: 0, discovered: 0 },
    pool: null,
    freeStatic: 0,
    scanned: usage.lastScanAt !== null,
    online: 0,
    noReply: 0,
    discovered: 0,
    conflicts: 0,
    recent: 0,
    stale: 0,
    expiring: 0,
    noDns: 0,
    noPtr: 0,
  };
  let poolUsed = 0;
  const count: Record<IpamAddressFlag, keyof IpamNetworkStats> = {
    recent: 'recent',
    stale: 'stale',
    expiring: 'expiring',
    'no-dns': 'noDns',
    'no-ptr': 'noPtr',
  };
  for (const a of usage.addresses) {
    if (a.discovered) s.byType.discovered++;
    else s.byType[a.type]++;
    if (a.alive === true) s.online++;
    if (a.alive === false) s.noReply++;
    if (a.discovered) s.discovered++;
    if (a.conflict) s.conflicts++;
    for (const flag of ipamAddressFlags(a, now)) (s[count[flag]] as number)++;
    const ip = ipv4ToInt(a.address);
    if (ip !== null && inPool(ip)) poolUsed++;
  }
  if (poolSize > 0)
    s.pool = { size: poolSize, used: poolUsed, free: Math.max(0, poolSize - poolUsed) };
  s.freeStatic = Math.max(0, s.free - (s.pool?.free ?? 0));
  return s;
}

/** Summe der Kennzahlen mehrerer Netze (für die Zeile über allen Netzen). */
export function sumIpamStats(list: IpamNetworkStats[]): IpamNetworkStats {
  const sum: IpamNetworkStats = {
    total: 0,
    used: 0,
    free: 0,
    byType: { reservation: 0, lease: 0, static: 0, discovered: 0 },
    pool: null,
    freeStatic: 0,
    scanned: false,
    online: 0,
    noReply: 0,
    discovered: 0,
    conflicts: 0,
    recent: 0,
    stale: 0,
    expiring: 0,
    noDns: 0,
    noPtr: 0,
  };
  const keys = [
    'total',
    'used',
    'free',
    'freeStatic',
    'online',
    'noReply',
    'discovered',
    'conflicts',
    'recent',
    'stale',
    'expiring',
    'noDns',
    'noPtr',
  ] as const;
  for (const s of list) {
    for (const key of keys) sum[key] += s[key];
    for (const key of Object.keys(sum.byType) as (keyof IpamNetworkStats['byType'])[])
      sum.byType[key] += s.byType[key];
    if (s.pool) {
      sum.pool ??= { size: 0, used: 0, free: 0 };
      sum.pool.size += s.pool.size;
      sum.pool.used += s.pool.used;
      sum.pool.free += s.pool.free;
    }
    sum.scanned ||= s.scanned;
  }
  return sum;
}

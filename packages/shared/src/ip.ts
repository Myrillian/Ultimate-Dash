/** IPv4-Hilfen, die Frontend und Backend gleichermaßen brauchen (Bereiche, Auslastung, später IPAM). */

export function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

export function ipv4InRange(address: string, start: string, end: string): boolean {
  const a = ipv4ToInt(address);
  const s = ipv4ToInt(start);
  const e = ipv4ToInt(end);
  return a !== null && s !== null && e !== null && a >= s && a <= e;
}

/** Anzahl Adressen von `start` bis `end` einschließlich; 0 bei ungültigen oder verkehrten Angaben. */
export function ipv4RangeSize(start: string, end: string): number {
  const s = ipv4ToInt(start);
  const e = ipv4ToInt(end);
  return s === null || e === null || e < s ? 0 : e - s + 1;
}

/** Größe eines Bereichs ohne die ausgeschlossenen Teilbereiche (überlappende Ausschlüsse zählen nur einmal). */
export function ipv4PoolSize(
  start: string,
  end: string,
  exclusions: { startingAddress: string; endingAddress: string }[],
): number {
  const s = ipv4ToInt(start);
  const e = ipv4ToInt(end);
  if (s === null || e === null || e < s) return 0;
  const ranges = exclusions
    .map((x) => [ipv4ToInt(x.startingAddress), ipv4ToInt(x.endingAddress)] as const)
    .filter((r): r is readonly [number, number] => r[0] !== null && r[1] !== null && r[1] >= r[0])
    .map(([a, b]) => [Math.max(a, s), Math.min(b, e)] as const)
    .filter(([a, b]) => b >= a)
    .sort((x, y) => x[0] - y[0]);
  let excluded = 0;
  let cursor = -1;
  for (const [a, b] of ranges) {
    const from = Math.max(a, cursor + 1);
    if (b >= from) excluded += b - from + 1;
    cursor = Math.max(cursor, b);
  }
  return e - s + 1 - excluded;
}

/** Präfixlänge einer Netzmaske wie `255.255.255.0` (24); null, wenn die Maske nicht zusammenhängend ist. */
export function maskToPrefix(mask: string): number | null {
  const value = ipv4ToInt(mask);
  if (value === null) return null;
  let prefix = 0;
  while (prefix < 32 && (value >>> (31 - prefix)) & 1) prefix++;
  // Nach den führenden Einsen dürfen nur noch Nullen folgen.
  const rest = prefix === 32 ? 0 : value % 2 ** (32 - prefix);
  return rest === 0 ? prefix : null;
}

/** Teilbereiche von `start` bis `end` ohne die ausgeschlossenen Adressen, aufsteigend. */
export function ipv4Segments(
  start: string,
  end: string,
  exclusions: { startingAddress: string; endingAddress: string }[],
): { start: string; end: string }[] {
  const s = ipv4ToInt(start);
  const e = ipv4ToInt(end);
  if (s === null || e === null || e < s) return [];
  const holes = exclusions
    .map((x) => [ipv4ToInt(x.startingAddress), ipv4ToInt(x.endingAddress)] as const)
    .filter((r): r is readonly [number, number] => r[0] !== null && r[1] !== null && r[1] >= r[0])
    .sort((a, b) => a[0] - b[0]);
  const result: { start: string; end: string }[] = [];
  let cursor = s;
  for (const [a, b] of holes) {
    if (b < cursor) continue;
    if (a > e) break;
    if (a > cursor) result.push({ start: intToIpv4(cursor), end: intToIpv4(Math.min(a - 1, e)) });
    cursor = Math.max(cursor, b + 1);
  }
  if (cursor <= e) result.push({ start: intToIpv4(cursor), end: intToIpv4(e) });
  return result;
}

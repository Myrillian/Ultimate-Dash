import { z } from 'zod';
import { intToIpv4, ipv4ToInt } from './ip.js';

/** Farbschlüssel für Kategorien; die Töne stehen als `--cat-*` in der Oberfläche (hell/dunkel). */
export const categoryColors = [
  'blue',
  'orange',
  'aqua',
  'yellow',
  'magenta',
  'green',
  'violet',
  'red',
] as const;
export type CategoryColor = (typeof categoryColors)[number];

export interface ParsedCidr {
  /** Netzadresse als Zahl */
  first: number;
  /** Broadcast-Adresse als Zahl */
  last: number;
  prefix: number;
  /** Alle Adressen im Netz, auch Netz- und Broadcast-Adresse */
  size: number;
}

/**
 * Liest `10.10.0.0/24`. Die Netzadresse muss stimmen (kein `10.10.0.5/24`). Erlaubt sind /16 bis /30:
 * größere Netze wären als Raster unbrauchbar, kleinere (/31, /32) haben keine Hostadressen im üblichen Sinn.
 */
export function parseCidr(cidr: string): ParsedCidr | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) return null;
  const base = ipv4ToInt(match[1]!);
  const prefix = Number(match[2]);
  if (base === null || prefix < 16 || prefix > 30) return null;
  const size = 2 ** (32 - prefix);
  if (base % size !== 0) return null;
  return { first: base, last: base + size - 1, prefix, size };
}

export const cidrToString = (parsed: ParsedCidr) => `${intToIpv4(parsed.first)}/${parsed.prefix}`;

export const cidrsOverlap = (a: ParsedCidr, b: ParsedCidr) =>
  a.first <= b.last && b.first <= a.last;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const cidr = z
  .string()
  .trim()
  .refine(
    (value) => parseCidr(value) !== null,
    'Ungültiges Netz (Beispiel: 10.10.10.0/24, Präfix 16 bis 30, Netzadresse am Anfang)',
  );

export const ipamNetworkInput = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(100),
  cidr,
  vlanId: z
    .number()
    .int()
    .min(1)
    .max(4094)
    .nullish()
    .transform((value) => value ?? null),
  gateway: z
    .union([z.ipv4(), z.literal('')])
    .nullish()
    .transform((value) => value || null),
  description: optionalText(500),
});
export type IpamNetworkInput = z.input<typeof ipamNetworkInput>;

export const ipamCategoryInput = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  color: z.enum(categoryColors),
  description: optionalText(300),
});
export type IpamCategoryInput = z.input<typeof ipamCategoryInput>;

export const ipamRangeInput = z.object({
  networkId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  startAddress: z.ipv4(),
  endAddress: z.ipv4(),
  label: optionalText(100),
});
export type IpamRangeInput = z.input<typeof ipamRangeInput>;

/**
 * Prüft einen Bereich gegen sein Netz und die übrigen Bereiche desselben Netzes.
 * Gibt eine verständliche Meldung zurück oder `null`, wenn alles passt.
 */
export function validateRange(
  network: string,
  others: { startAddress: string; endAddress: string; label?: string | null }[],
  candidate: { startAddress: string; endAddress: string },
): string | null {
  const net = parseCidr(network);
  const start = ipv4ToInt(candidate.startAddress);
  const end = ipv4ToInt(candidate.endAddress);
  if (!net || start === null || end === null) return 'Ungültiger Bereich';
  if (end < start) return 'Das Ende liegt vor dem Anfang';
  if (start < net.first || end > net.last) return `Der Bereich liegt nicht in ${network}`;
  for (const other of others) {
    const s = ipv4ToInt(other.startAddress)!;
    const e = ipv4ToInt(other.endAddress)!;
    if (start <= e && s <= end) {
      return `Überschneidet sich mit ${other.startAddress} – ${other.endAddress}${other.label ? ` (${other.label})` : ''}`;
    }
  }
  return null;
}

export interface IpamNetwork {
  id: number;
  name: string;
  cidr: string;
  vlanId: number | null;
  gateway: string | null;
  description: string | null;
}

export interface IpamCategory {
  id: number;
  name: string;
  color: CategoryColor;
  description: string | null;
}

export interface IpamRange {
  id: number;
  networkId: number;
  categoryId: number;
  startAddress: string;
  endAddress: string;
  label: string | null;
}

export interface IpamData {
  networks: IpamNetwork[];
  categories: IpamCategory[];
  ranges: IpamRange[];
}

/** Woher die Belegung einer Adresse bekannt ist. */
export interface IpamClaim {
  source: 'lease' | 'reservation' | 'dns';
  /** MAC bei Lease/Reservierung */
  mac: string | null;
  name: string | null;
  scope: string | null;
}

export interface IpamAddressUsage {
  address: string;
  claims: IpamClaim[];
  /** Mindestens zwei verschiedene Geräte (MAC) beanspruchen die Adresse. */
  conflict: boolean;
}

export interface IpamNetworkUsage {
  networkId: number;
  /** Nutzbare Adressen (ohne Netz- und Broadcast-Adresse) */
  hosts: number;
  used: number;
  /** DHCP-Pools, die im Netz liegen (ohne Ausschlüsse als Teilbereiche) */
  pools: {
    scope: string;
    enabled: boolean;
    start: string;
    end: string;
    exclusions: { start: string; end: string }[];
  }[];
  /** Nur belegte Adressen; freie ergeben sich aus dem Rest. */
  addresses: IpamAddressUsage[];
  /** Belegung je Bereich (Schlüssel = Range-ID) */
  rangeUse: Record<number, { size: number; used: number }>;
  /** Belegte Adressen, die in keinem Bereich liegen */
  unassignedUsed: number;
  conflicts: number;
}

export interface IpamUsage {
  /** false, wenn Technitium nicht verbunden oder nicht erreichbar ist */
  available: boolean;
  reason: string | null;
  networks: Record<number, IpamNetworkUsage>;
}

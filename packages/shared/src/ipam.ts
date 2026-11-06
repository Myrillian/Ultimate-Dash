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
  /** Per Ping auf Erreichbarkeit prüfen und unbekannte Geräte entdecken */
  scan: z.boolean().default(true),
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
  scan: boolean;
  /** Ende des letzten Ping-Durchlaufs über dieses Netz */
  lastScanAt: string | null;
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
  /** discovered = per Ping gefunden und nirgends sonst bekannt, manual = von Hand bestätigt */
  source: 'lease' | 'reservation' | 'dns' | 'discovered' | 'manual';
  /** MAC bei Lease/Reservierung */
  mac: string | null;
  name: string | null;
  scope: string | null;
  /** ID des Eintrags in der Liste der gefundenen Geräte (nur discovered/manual) */
  hostId: number | null;
}

/** Wie eine Adresse vergeben ist: per DHCP-Reservierung, dynamischer Lease oder statisch (nur DNS, entdeckt oder von Hand). */
export type IpamAddressType = 'reservation' | 'lease' | 'static';

export interface IpamAddressUsage {
  address: string;
  claims: IpamClaim[];
  type: IpamAddressType;
  /** Antwort auf den letzten Ping; null, solange das Netz noch nicht geprüft wurde */
  alive: boolean | null;
  /** Letzte erfolgreiche Antwort (ISO) */
  lastSeen: string | null;
  /** Nur per Ping gefunden und noch nicht bestätigt */
  discovered: boolean;
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
  /** Davon gefunden, aber noch nicht bestätigt */
  discovered: number;
  /** Antworten beim letzten Ping-Durchlauf */
  online: number;
  lastScanAt: string | null;
}

export interface IpamUsage {
  /** false, wenn Technitium nicht verbunden oder nicht erreichbar ist */
  available: boolean;
  reason: string | null;
  networks: Record<number, IpamNetworkUsage>;
}

/** Alles zu einer einzelnen IP-Adresse: Zuordnung, DHCP, DNS und Erreichbarkeit (für das Seitenfenster). */
export interface IpamIpDetail {
  address: string;
  networkId: number;
  rangeId: number | null;
  categoryId: number | null;
  /** Frei, wenn weder DHCP, DNS noch ein gefundenes Gerät die Adresse belegt. */
  state: 'free' | 'used';
  /** Art der Vergabe; bei freien Adressen null. */
  type: IpamAddressType | null;
  discovered: boolean;
  conflict: boolean;
  alive: boolean | null;
  lastSeen: string | null;
  /** ID in der Liste gefundener Geräte (entdeckt oder bestätigt) */
  hostId: number | null;
  hostName: string | null;
  dhcp: {
    /** Scope, dessen Bereich die Adresse enthält */
    pool: { scope: string; enabled: boolean; excluded: boolean } | null;
    reservation: {
      scope: string;
      mac: string;
      hostName: string | null;
      comment: string | null;
    } | null;
    lease: {
      scope: string;
      mac: string;
      hostName: string | null;
      obtained: string | null;
      expires: string | null;
    } | null;
  };
  dns: {
    /** A-Einträge, die auf die Adresse zeigen */
    forward: { zone: string; domain: string; ttl: number; comment: string | null }[];
    /** PTR-Eintrag in der Reverse-Zone, falls vorhanden */
    reverse: { zone: string; domain: string; target: string; ttl: number } | null;
    /** Reverse-Zone existiert in Technitium (sonst kann kein PTR angelegt werden) */
    reverseZone: string | null;
  };
}

/** Ein DHCP-Scope aus Technitium, zu dem es noch kein Netz gibt. */
export interface IpamSuggestion {
  scope: string;
  cidr: string;
  gateway: string | null;
  domain: string | null;
  /** Verteilbare Adressen (Scope-Bereich ohne Ausschlüsse), begrenzt auf die Hostadressen des Netzes */
  pools: { start: string; end: string }[];
  /** Name eines bestehenden Netzes, das sich mit dem Scope überschneidet; dann ist kein Import möglich */
  overlaps: string | null;
}

/** Ein Netz weicht von dem Scope in Technitium ab, der dasselbe Netz bedient. */
export interface IpamDrift {
  networkId: number;
  networkName: string;
  scope: string;
  field: 'gateway';
  local: string | null;
  remote: string;
}

export interface IpamSync {
  available: boolean;
  reason: string | null;
  suggestions: IpamSuggestion[];
  drift: IpamDrift[];
}

export const ipamImportInput = z.object({
  scopes: z.array(z.string().trim().min(1)).min(1, 'Wähle mindestens einen Scope'),
  /** Die verteilbaren Adressen als Bereich der Kategorie „DHCP“ anlegen */
  withPoolRange: z.boolean().default(true),
});
export type IpamImportInput = z.input<typeof ipamImportInput>;

export const ipamHostUpdate = z.object({
  name: optionalText(100),
  /** true = als bekannt bestätigt (nicht mehr hervorgehoben) */
  acknowledged: z.boolean(),
});
export type IpamHostUpdate = z.input<typeof ipamHostUpdate>;

export const SCAN_INTERVALS = [5, 15, 30, 60, 180, 720, 1440] as const;

export const ipamScanSettings = z.object({
  enabled: z.boolean(),
  /** Abstand zwischen zwei Durchläufen in Minuten */
  intervalMinutes: z.number().int().min(5).max(1440),
});
export type IpamScanSettings = z.infer<typeof ipamScanSettings>;

export interface IpamScanStatus extends IpamScanSettings {
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Dauer des letzten Durchlaufs in Sekunden */
  lastDurationSeconds: number | null;
  /** Anzahl geprüfter Adressen im letzten Durchlauf */
  lastChecked: number | null;
  lastError: string | null;
}

/** Erreichbarkeit aller bekannten Adressen, z. B. für die DNS-Ansicht. */
export interface IpamReachability {
  /** Netze, die schon geprüft wurden; Adressen darin ohne Antwort gelten als offline */
  scanned: string[];
  hosts: Record<string, { alive: boolean; lastSeen: string | null }>;
}

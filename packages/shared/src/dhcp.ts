import { z } from 'zod';
import { dnsName } from './dns.js';
import { httpUrl } from './schemas.js';

/** MAC-Adresse mit `:` oder `-`, gespeichert wie bei Technitium: Großbuchstaben, Bindestriche. */
export const macAddress = z
  .string()
  .trim()
  .regex(
    /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/,
    'Ungültige MAC-Adresse (Beispiel: 00-1A-2B-3C-4D-5E)',
  )
  .transform((value) => value.replace(/:/g, '-').toUpperCase());

const scopeName = z.string().trim().min(1).max(100);

/** ID des Technitium-Servers, der den Scope bedient; `main` ist die Hauptverbindung. */
export const MAIN_DHCP_SERVER = 'main';
const serverId = z.string().trim().min(1).max(40).default(MAIN_DHCP_SERVER);

const optionalHost = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullish()
  .transform((value) => value ?? null)
  .pipe(dnsName.nullable());

const optionalComment = z
  .string()
  .trim()
  .max(200)
  // `|` trennt bei Technitium die Felder einer Reservierung.
  .refine((value) => !value.includes('|'), 'Das Zeichen „|“ ist nicht erlaubt')
  .transform((value) => (value === '' ? null : value))
  .nullish()
  .transform((value) => value ?? null);

export const dhcpReservationInput = z.object({
  server: serverId,
  scope: scopeName,
  hardwareAddress: macAddress,
  ipAddress: z.ipv4(),
  hostName: optionalHost,
  comments: optionalComment,
});
export type DhcpReservationInput = z.input<typeof dhcpReservationInput>;

export const dhcpReservationUpdate = dhcpReservationInput.extend({
  /** MAC der Reservierung, wie sie aktuell besteht (die MAC selbst darf sich ändern) */
  currentHardwareAddress: macAddress,
});
export type DhcpReservationUpdate = z.input<typeof dhcpReservationUpdate>;

export const dhcpReservationDelete = z.object({
  server: serverId,
  scope: scopeName,
  hardwareAddress: macAddress,
});
export type DhcpReservationDelete = z.input<typeof dhcpReservationDelete>;

export const dhcpScopeState = z.object({
  server: serverId,
  scope: scopeName,
  enabled: z.boolean(),
});
export type DhcpScopeState = z.input<typeof dhcpScopeState>;

/** reserve = dynamische Lease in Reservierung umwandeln, unreserve = zurück, remove = Lease freigeben */
export const dhcpLeaseAction = z.object({
  server: serverId,
  scope: scopeName,
  hardwareAddress: macAddress,
  action: z.enum(['reserve', 'unreserve', 'remove']),
});
export type DhcpLeaseAction = z.input<typeof dhcpLeaseAction>;

export interface DhcpIpRange {
  startingAddress: string;
  endingAddress: string;
}

export interface DhcpReservation {
  hardwareAddress: string;
  address: string;
  hostName: string | null;
  comments: string | null;
}

export interface DhcpScope {
  /** Technitium-Server, auf dem der Scope liegt */
  server: string;
  serverName: string;
  name: string;
  enabled: boolean;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  networkAddress: string | null;
  routerAddress: string | null;
  domainName: string | null;
  dnsServers: string[];
  /** Leasedauer in Minuten */
  leaseMinutes: number;
  exclusions: DhcpIpRange[];
  reservations: DhcpReservation[];
  allowOnlyReservedLeases: boolean;
}

export interface DhcpLease {
  server: string;
  serverName: string;
  scope: string;
  type: 'Dynamic' | 'Reserved';
  hardwareAddress: string;
  address: string;
  hostName: string | null;
  /** ISO-Zeitpunkt (UTC); ältere Technitium-Versionen liefern „MM/dd/yyyy HH:mm:ss“ in Serverzeit */
  obtained: string | null;
  expires: string | null;
}

/** Weiterer Technitium-Server, dessen DHCP mit ausgelesen wird (z. B. zweiter Knoten). */
export const dhcpServerInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen angeben').max(60),
  url: httpUrl.transform((value) => value.replace(/\/+$/, '')),
  /** Leer = Token der Hauptverbindung verwenden (z. B. im Technitium-Cluster) bzw. beim Ändern behalten */
  token: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** true = eigenes Token verwerfen und das der Hauptverbindung nutzen */
  useMainToken: z.boolean().default(false),
  tlsInsecure: z.boolean().default(false),
});
export type DhcpServerInput = z.input<typeof dhcpServerInput>;

export interface DhcpServer {
  id: string;
  name: string;
  url: string;
  tlsInsecure: boolean;
  /** false = nutzt das Token der Hauptverbindung */
  ownToken: boolean;
  /** Die Hauptverbindung aus „Technitium DNS“; nur hier änderbar */
  primary: boolean;
  /** Fehler beim letzten Abruf, sonst null */
  error: string | null;
}

/** Eindeutiger Schlüssel eines Scopes über alle Server (Server-IDs enthalten kein „/“). */
export const dhcpScopeKey = (scope: { server: string; name: string }) =>
  `${scope.server}/${scope.name}`;

export function parseDhcpScopeKey(key: string): { server: string; scope: string } {
  const i = key.indexOf('/');
  return i < 0
    ? { server: MAIN_DHCP_SERVER, scope: key }
    : { server: key.slice(0, i), scope: key.slice(i + 1) };
}

/** true, wenn Scopes von mehr als einem Server stammen und der Server mit angezeigt werden muss */
export const multipleDhcpServers = (scopes: { server: string }[]) =>
  new Set(scopes.map((s) => s.server)).size > 1;

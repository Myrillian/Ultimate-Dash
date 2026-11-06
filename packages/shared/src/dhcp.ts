import { z } from 'zod';
import { dnsName } from './dns.js';

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

export const dhcpReservationDelete = z.object({ scope: scopeName, hardwareAddress: macAddress });
export type DhcpReservationDelete = z.input<typeof dhcpReservationDelete>;

export const dhcpScopeState = z.object({ scope: scopeName, enabled: z.boolean() });
export type DhcpScopeState = z.input<typeof dhcpScopeState>;

/** reserve = dynamische Lease in Reservierung umwandeln, unreserve = zurück, remove = Lease freigeben */
export const dhcpLeaseAction = z.object({
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
  scope: string;
  type: 'Dynamic' | 'Reserved';
  hardwareAddress: string;
  address: string;
  hostName: string | null;
  /** Zeitangaben so, wie Technitium sie liefert (Serverzeit) */
  obtained: string | null;
  expires: string | null;
}

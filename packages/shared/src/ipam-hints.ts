import type { IpamClaim } from './ipam.js';

/** Hinweise zur Konsistenz zwischen DHCP und DNS an einer IP-Adresse. */
export type IpamHintKind = 'dns-missing' | 'name-differs' | 'ptr-missing';

export const ipamHintLabels: Record<IpamHintKind, string> = {
  'dns-missing': 'DNS fehlt',
  'name-differs': 'Name weicht ab',
  'ptr-missing': 'PTR fehlt',
};

/** Erster Namensteil in Kleinbuchstaben („NAS.home.lan“ → „nas“), zum Vergleichen von Host- und DNS-Namen. */
export const hostLabel = (name: string): string =>
  name.trim().replace(/\.$/, '').split('.')[0]!.toLowerCase();

export interface IpamHintInput {
  /** Hostname der DHCP-Reservierung; null ohne Reservierung oder ohne Namen. */
  reservationName: string | null;
  /** Vollständige Namen der A-Einträge, die auf die Adresse zeigen. */
  dnsNames: string[];
  /** Es gibt eine Reverse-Zone, in der ein PTR liegen könnte; `undefined`, wenn unbekannt. */
  reverseZone?: string | null;
  /** Es gibt einen PTR-Eintrag; `undefined`, wenn unbekannt (z. B. in der Liste). */
  hasPtr?: boolean;
}

/**
 * Berechnet die Hinweise. Nur Reservierungen mit Namen werden geprüft: dynamische Leases
 * wechseln zu oft, als dass ein fehlender Eintrag ein Fehler wäre.
 */
export function ipamHints(input: IpamHintInput): IpamHintKind[] {
  const hints: IpamHintKind[] = [];
  const name = input.reservationName?.trim() || null;
  if (name && input.dnsNames.length === 0) hints.push('dns-missing');
  if (
    name &&
    input.dnsNames.length > 0 &&
    !input.dnsNames.some((d) => hostLabel(d) === hostLabel(name))
  )
    hints.push('name-differs');
  if (input.dnsNames.length > 0 && input.reverseZone && input.hasPtr === false)
    hints.push('ptr-missing');
  return hints;
}

/** Hinweise aus den Belegungsdaten der Liste (ohne PTR, den die Liste nicht kennt). */
export function ipamHintsFromClaims(claims: IpamClaim[]): IpamHintKind[] {
  return ipamHints({
    reservationName: claims.find((c) => c.source === 'reservation')?.name ?? null,
    dnsNames: claims.filter((c) => c.source === 'dns').flatMap((c) => (c.name ? [c.name] : [])),
  });
}

/** Lesbare Bezeichnungen für die Aktionen im Änderungsprotokoll. */

const LABELS: Record<string, string> = {
  'technitium.connect': 'Technitium verbunden',
  'technitium.disconnect': 'Technitium getrennt',
  'proxmox.connect': 'Proxmox verbunden',
  'proxmox.disconnect': 'Proxmox getrennt',
  'technitium.blocking.enable': 'Werbeblocker eingeschaltet',
  'technitium.blocking.disable': 'Werbeblocker ausgeschaltet',
  'technitium.blocking.pause': 'Werbeblocker pausiert',
  'technitium.blocking.update-lists': 'Blocklisten aktualisiert',
  'technitium.record.add': 'DNS-Eintrag angelegt',
  'technitium.record.update': 'DNS-Eintrag geändert',
  'technitium.record.delete': 'DNS-Eintrag gelöscht',
  'technitium.dhcp.scope.enable': 'DHCP-Scope aktiviert',
  'technitium.dhcp.scope.disable': 'DHCP-Scope deaktiviert',
  'technitium.dhcp.reservation.add': 'Reservierung angelegt',
  'technitium.dhcp.reservation.update': 'Reservierung geändert',
  'technitium.dhcp.reservation.delete': 'Reservierung gelöscht',
  'technitium.dhcp.lease.remove': 'Lease freigegeben',
  'technitium.dhcp.lease.reserve': 'Lease in Reservierung umgewandelt',
  'technitium.dhcp.lease.unreserve': 'Reservierung aufgehoben',
  'technitium.dhcp.server.add': 'DHCP-Server hinzugefügt',
  'technitium.dhcp.server.update': 'DHCP-Server geändert',
  'technitium.dhcp.server.delete': 'DHCP-Server entfernt',
  'ipam.network.create': 'Netz angelegt',
  'ipam.network.update': 'Netz geändert',
  'ipam.network.delete': 'Netz gelöscht',
  'ipam.range.create': 'Bereich angelegt',
  'ipam.range.update': 'Bereich geändert',
  'ipam.range.delete': 'Bereich gelöscht',
  'ipam.category.create': 'Kategorie angelegt',
  'ipam.category.update': 'Kategorie geändert',
  'ipam.category.delete': 'Kategorie gelöscht',
  'ipam.host.update': 'Host geändert',
  'ipam.host.acknowledge': 'Entdeckten Host bestätigt',
  'ipam.host.forget': 'Host vergessen',
  'ipam.scan.settings': 'Ping-Prüfung eingestellt',
  'ipam.scan.run': 'Ping-Prüfung gestartet',
  'ipam.import': 'Abgleich mit Technitium',
};

export const actionLabel = (action: string): string => LABELS[action] ?? action;

export type AuditArea = 'dns' | 'dhcp' | 'ipam' | 'system';
export const areaLabels: Record<AuditArea, string> = {
  dns: 'DNS',
  dhcp: 'DHCP',
  ipam: 'IPAM',
  system: 'Verbindung',
};

/** Bereich einer Aktion, für den Filter. */
export function areaOf(action: string): AuditArea {
  if (action.startsWith('ipam.')) return 'ipam';
  if (action.startsWith('technitium.dhcp.')) return 'dhcp';
  if (action.startsWith('technitium.record.') || action.startsWith('technitium.blocking.'))
    return 'dns';
  return 'system';
}

/** Zeitraum-Filter: Schlüssel → Länge in Millisekunden. */
export const RANGES = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
export const rangeLabels: Record<keyof typeof RANGES, string> = {
  '1d': '24 Stunden',
  '7d': '7 Tage',
  '30d': '30 Tage',
};

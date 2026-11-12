import type { ZoraxyCertificate, ZoraxyHost, ZoraxySummary } from '@ultimate-dash/shared';

/**
 * Zoraxy hat keine dokumentierte, stabile API. Die Antworten werden deshalb nur lose
 * gelesen: Schlüssel ohne Rücksicht auf Groß-/Kleinschreibung, unbekannte Felder ignoriert,
 * fehlende Felder erlaubt.
 */
type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Liest ein Feld, egal wie es geschrieben ist (`RootOrMatchingDomain`, `rootOrMatchingDomain`). */
export function field(object: unknown, ...names: string[]): unknown {
  if (!isObject(object)) return undefined;
  const keys = new Map(Object.keys(object).map((key) => [key.toLowerCase(), key]));
  // Die Namen gelten in der angegebenen Reihenfolge.
  for (const name of names) {
    const key = keys.get(name.toLowerCase());
    if (key !== undefined) return object[key];
  }
  return undefined;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export interface UptimeEntry {
  /** Host aus der überwachten Adresse, kleingeschrieben */
  host: string;
  online: boolean;
}

/** Host einer Adresse oder eines Namens: `https://a.example.org/x` → `a.example.org`. */
export function hostOf(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`)
      .hostname;
  } catch {
    return trimmed;
  }
}

/**
 * Der Uptime-Monitor liefert je Ziel eine Liste von Messwerten (oder einen Objekt-Eintrag je
 * Ziel). Es zählt der jeweils letzte Wert.
 */
export function parseUptime(raw: unknown): UptimeEntry[] {
  const records: unknown[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (
        isObject(last) &&
        ('Online' in last || 'online' in last || 'URL' in last || 'url' in last)
      )
        records.push(last);
      else value.forEach(collect);
    } else if (isObject(value)) {
      if (field(value, 'Online') !== undefined) records.push(value);
      else Object.values(value).forEach(collect);
    }
  };
  collect(raw);
  const entries = new Map<string, boolean>();
  for (const record of records) {
    const host = hostOf(text(field(record, 'URL', 'Name', 'ID')));
    const online = field(record, 'Online');
    if (host && typeof online === 'boolean') entries.set(host, online);
  }
  return [...entries].map(([host, online]) => ({ host, online }));
}

export interface RawCertificate {
  domain: string;
  expiresAt: Date | null;
}

/** `_.example.org` ist bei Zoraxy der Dateiname eines Wildcard-Zertifikats. */
const certDomain = (name: string) => name.trim().toLowerCase().replace(/^_\./, '*.');

/** Antwort von `cert/list?date=true`; ohne Datum liefert Zoraxy nur Namen. */
export function parseCertificates(raw: unknown): RawCertificate[] {
  return list(raw).flatMap((item): RawCertificate[] => {
    if (typeof item === 'string') {
      return item.trim() ? [{ domain: certDomain(item), expiresAt: null }] : [];
    }
    const domain = certDomain(text(field(item, 'Domain', 'Name')));
    if (!domain) return [];
    const expire = text(field(item, 'ExpireDate', 'Expire', 'NotAfter'));
    // Zoraxy schreibt „2026-12-31 23:59:59“ ohne Zeitzone; das ist UTC.
    const plain = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(expire);
    const parsed = expire ? new Date(plain ? `${plain[1]}T${plain[2]}Z` : expire) : null;
    const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    return [{ domain, expiresAt: date }];
  });
}

/** Gilt das Zertifikat für diese Domain? Exakt oder per Wildcard (`*.example.org`). */
export function certCovers(certificate: string, domain: string): boolean {
  const host = domain.toLowerCase();
  if (certificate === host) return true;
  if (!certificate.startsWith('*.')) return false;
  const suffix = certificate.slice(1);
  // Ein Wildcard deckt genau eine Ebene ab.
  return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes('.');
}

const DAY = 86_400_000;

export const daysUntil = (date: Date | null, now: number) =>
  date ? Math.floor((date.getTime() - now) / DAY) : null;

function parseHost(item: unknown): Omit<ZoraxyHost, 'online' | 'certDays'> | null {
  const domain = text(field(item, 'RootOrMatchingDomain'));
  if (!domain) return null;
  const upstream = (value: unknown, active: boolean) => {
    const target = text(field(value, 'OriginIpOrDomain'));
    return target ? [{ target, tls: field(value, 'RequireTLS') === true, active }] : [];
  };
  return {
    domain,
    aliases: list(field(item, 'MatchingDomainAlias')).map(text).filter(Boolean),
    upstreams: [
      ...list(field(item, 'ActiveOrigins')).flatMap((o) => upstream(o, true)),
      ...list(field(item, 'InactiveOrigins')).flatMap((o) => upstream(o, false)),
    ],
    enabled: field(item, 'Disabled') !== true,
    tags: list(field(item, 'Tags')).map(text).filter(Boolean),
  };
}

export interface SummaryInput {
  hosts: unknown;
  certificates: unknown | null;
  uptime: unknown | null;
  stats: unknown | null;
  version: string | null;
  warnings: string[];
}

export function summarize(input: SummaryInput, now = new Date()): ZoraxySummary {
  const certificates = input.certificates === null ? [] : parseCertificates(input.certificates);
  const uptime = new Map(
    (input.uptime === null ? [] : parseUptime(input.uptime)).map((e) => [e.host, e.online]),
  );

  const hosts = list(input.hosts)
    .map(parseHost)
    .filter((host): host is NonNullable<typeof host> => host !== null)
    .map((host): ZoraxyHost => {
      const names = [host.domain, ...host.aliases].map((name) => name.toLowerCase());
      const monitored = names
        .map((name) => uptime.get(hostOf(name)))
        .filter((v) => v !== undefined);
      // Zoraxy liefert bei der Anmeldung das genau passende Zertifikat vor dem Wildcard-Zertifikat.
      const covering = names
        .map((name) => {
          const exact = certificates.filter((cert) => cert.domain === name);
          const matching = exact.length
            ? exact
            : certificates.filter((cert) => certCovers(cert.domain, name));
          const days = matching
            .map((cert) => daysUntil(cert.expiresAt, now.getTime()))
            .filter((value): value is number => value !== null);
          return days.length ? Math.max(...days) : null;
        })
        .filter((days): days is number => days !== null);
      return {
        ...host,
        online: monitored.length === 0 ? null : monitored.every(Boolean),
        certDays: covering.length === 0 ? null : Math.min(...covering),
      };
    })
    .sort(
      (a, b) => Number(b.enabled) - Number(a.enabled) || a.domain.localeCompare(b.domain, 'de'),
    );

  const certs: ZoraxyCertificate[] = certificates
    .map((cert) => ({
      domain: cert.domain,
      expiresAt: cert.expiresAt ? cert.expiresAt.toISOString() : null,
      daysLeft: daysUntil(cert.expiresAt, now.getTime()),
    }))
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

  const active = hosts.filter((host) => host.enabled);
  const total = num(field(input.stats, 'TotalRequest', 'TotalRequests'));
  const errors = num(field(input.stats, 'ErrorRequest', 'ErrorRequests'));

  return {
    fetchedAt: now.toISOString(),
    version: input.version,
    hosts,
    counts: {
      hosts: hosts.length,
      enabled: active.length,
      online: active.filter((host) => host.online === true).length,
      offline: active.filter((host) => host.online === false).length,
    },
    certificates: certs,
    nextExpiryDays: certs.find((cert) => cert.daysLeft !== null)?.daysLeft ?? null,
    requests: total === null ? null : { total, errors: errors ?? 0 },
    warnings: input.warnings,
  };
}

/** Version aus `/api/info/x`; Zoraxy nennt sie je nach Ausgabe anders. */
export function parseVersion(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (!isObject(raw)) return null;
  for (const [key, value] of Object.entries(raw)) {
    if (/version/i.test(key) && typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

import { z } from 'zod';
import { httpUrl } from './schemas.js';

/** Verbindungsdaten zu Zoraxy. Das Passwort verlässt den Server nie. */
export const zoraxySettingsInput = z.object({
  url: httpUrl.transform((value) => value.replace(/\/+$/, '')),
  username: z.string().trim().min(1, 'Bitte den Benutzernamen angeben').max(100),
  /** Leer oder weggelassen = bisheriges Passwort behalten. */
  password: z
    .string()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Selbst signiertes Zertifikat akzeptieren. */
  tlsInsecure: z.boolean().default(false),
});
export type ZoraxySettingsInput = z.input<typeof zoraxySettingsInput>;

export interface ZoraxySettings {
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  tlsInsecure: boolean;
  /** env = über Umgebungsvariablen gesetzt und daher in der Oberfläche nicht änderbar */
  source: 'env' | 'settings' | null;
}

export interface ZoraxyTestResult {
  /** null, wenn Zoraxy die Version nicht nennt */
  version: string | null;
  hosts: number;
  enabledHosts: number;
  certificates: number;
  /** Teile, die nicht gelesen werden konnten (der Rest funktioniert trotzdem) */
  warnings: string[];
}

export interface ZoraxyHost {
  /** Hauptdomain der Regel; „*“ oder leer = Standardseite */
  domain: string;
  aliases: string[];
  /** Ziele, z. B. `192.168.1.20:8080` */
  upstreams: { target: string; tls: boolean; active: boolean }[];
  enabled: boolean;
  tags: string[];
  /** Antwort laut Uptime-Monitor von Zoraxy; null = nicht überwacht */
  online: boolean | null;
  /** Aufrufe heute (Domain und Aliase); null = Zoraxy liefert keine Statistik */
  hitsToday: number | null;
  /** Restlaufzeit des passenden Zertifikats in Tagen; null = kein Zertifikat gefunden */
  certDays: number | null;
}

export interface ZoraxyCertificate {
  domain: string;
  /** ISO-Zeitpunkt, null wenn Zoraxy kein Ablaufdatum liefert */
  expiresAt: string | null;
  daysLeft: number | null;
}

export interface ZoraxySummary {
  fetchedAt: string;
  version: string | null;
  /** Aktive Regeln nach Domain sortiert, deaktivierte zuletzt */
  hosts: ZoraxyHost[];
  counts: {
    hosts: number;
    enabled: number;
    /** laut Uptime-Monitor erreichbar / nicht erreichbar (nur überwachte, aktive Hosts) */
    online: number;
    offline: number;
  };
  certificates: ZoraxyCertificate[];
  /** Kürzeste Restlaufzeit aller Zertifikate in Tagen; null = unbekannt */
  nextExpiryDays: number | null;
  /** Anfragen des heutigen Tages; null = Zoraxy liefert sie nicht */
  requests: { total: number; errors: number } | null;
  /** Teile, die nicht gelesen werden konnten */
  warnings: string[];
}

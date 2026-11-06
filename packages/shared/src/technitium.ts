import { z } from 'zod';
import { httpUrl } from './schemas.js';

/** Verbindungsdaten zum Technitium DNS Server. Das Token verlässt den Server nie. */
export const technitiumSettingsInput = z.object({
  url: httpUrl.transform((value) => value.replace(/\/+$/, '')),
  /** Leer oder weggelassen = bisheriges Token behalten. */
  token: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Selbst signiertes Zertifikat akzeptieren (nur für https-Adressen relevant). */
  tlsInsecure: z.boolean().default(false),
});
export type TechnitiumSettingsInput = z.input<typeof technitiumSettingsInput>;

export interface TechnitiumSettings {
  url: string | null;
  hasToken: boolean;
  tlsInsecure: boolean;
  /** env = über Umgebungsvariablen gesetzt und daher in der Oberfläche nicht änderbar */
  source: 'env' | 'settings' | null;
}

export interface TechnitiumTestResult {
  version: string;
  serverDomain: string;
}

export const statsRange = z.enum(['hour', 'day', 'week', 'month', 'year']);
export type StatsRange = z.infer<typeof statsRange>;

export interface DnsTopEntry {
  name: string;
  hits: number;
  /** Nur bei Clients: per Reverse-Lookup ermittelter Name */
  domain?: string | null;
}

export interface DnsBlockingState {
  enabled: boolean;
  /** Ende einer vorübergehenden Pause (ISO), sonst null */
  pausedUntil: string | null;
  /** Anzahl Domains aus Blocklisten plus eigene Sperrzonen */
  blockedDomains: number;
  listCount: number;
  nextListUpdate: string | null;
}

export interface DnsSummary {
  range: StatsRange;
  fetchedAt: string;
  serverDomain: string;
  version: string;
  totals: {
    queries: number;
    blocked: number;
    cached: number;
    authoritative: number;
    recursive: number;
    dropped: number;
    noError: number;
    nxDomain: number;
    serverFailure: number;
    refused: number;
    clients: number;
    zones: number;
  };
  /** Zeitreihe; `labels` als ISO-Zeitpunkte in UTC */
  series: {
    labels: string[];
    queries: number[];
    blocked: number[];
  };
  queryTypes: { name: string; hits: number }[];
  topDomains: DnsTopEntry[];
  topBlocked: DnsTopEntry[];
  topClients: DnsTopEntry[];
  blocking: DnsBlockingState;
}

export const blockingAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause'), minutes: z.number().int().min(1).max(1440) }),
  z.object({ action: z.literal('enable') }),
  z.object({ action: z.literal('disable') }),
  z.object({ action: z.literal('update-lists') }),
]);
export type BlockingAction = z.infer<typeof blockingAction>;

export interface AuditEntry {
  id: number;
  at: string;
  username: string | null;
  action: string;
  target: string | null;
  ok: boolean;
  error: string | null;
}

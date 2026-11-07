import { eq } from 'drizzle-orm';
import type {
  BlockingAction,
  DnsRecordCreate,
  DnsRecordDelete,
  DnsRecordList,
  DnsRecordUpdate,
  DnsSummary,
  DnsZone,
  DnsTopEntry,
  StatsRange,
  TechnitiumSettings,
  TechnitiumSettingsInput,
  TechnitiumTestResult,
  User,
} from '@ultimate-dash/shared';
import {
  dnsRecordCreate,
  dnsRecordDelete,
  dnsRecordUpdate,
  technitiumSettingsInput,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { callTechnitium, TechnitiumError, type TechnitiumConnection } from './client.js';
import {
  deleteParams,
  describeRecord,
  newValueParams,
  toRecord,
  toZone,
  valueParams,
  type RawRecord,
  type RawZone,
} from './records.js';

const SETTINGS_KEY = 'technitium';
/** So lange gelten abgerufene Statistiken; mehrere offene Dashboards teilen sich einen Abruf. */
const CACHE_MS = 15_000;

const RANGE_TYPES: Record<StatsRange, string> = {
  hour: 'LastHour',
  day: 'LastDay',
  week: 'LastWeek',
  month: 'LastMonth',
  year: 'LastYear',
};

/** Ausschnitt der Antworten, den wir tatsächlich lesen. */
interface RawStats {
  stats: Record<string, number | undefined>;
  mainChartData?: { labels?: string[]; datasets?: { label: string; data: number[] }[] };
  queryTypeChartData?: { labels?: string[]; datasets?: { data: number[] }[] };
  topClients?: { name: string; domain?: string; hits: number }[];
  topDomains?: { name: string; hits: number }[];
  topBlockedDomains?: { name: string; hits: number }[];
}

interface RawSettings {
  version: string;
  dnsServerDomain: string;
  enableBlocking: boolean;
  blockListUrls?: string[] | null;
  blockListNextUpdatedOn?: string | null;
  /** Nicht dokumentiert, von neueren Versionen während einer Pause mitgeliefert */
  temporaryDisableBlockingTill?: string | null;
}

export function connectionFromEnv(env = process.env): TechnitiumConnection | null {
  const url = env.TECHNITIUM_URL?.trim();
  const token = env.TECHNITIUM_TOKEN?.trim();
  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ''),
    token,
    tlsInsecure: env.TECHNITIUM_TLS_INSECURE === 'true',
  };
}

const top = (entries: { name: string; hits: number }[] | undefined): DnsTopEntry[] =>
  (entries ?? []).slice(0, 10).map(({ name, hits }) => ({ name, hits }));

export class TechnitiumService {
  private cache = new Map<StatsRange, { at: number; value: Promise<DnsSummary> }>();
  /** Ende einer selbst ausgelösten Pause, falls Technitium es nicht selbst meldet. */
  private pausedUntil: string | null = null;

  constructor(
    private readonly options: {
      db: Db;
      audit: AuditLog;
      envConnection?: TechnitiumConnection | null;
      timeoutMs?: number;
    },
  ) {}

  private stored(): TechnitiumConnection | null {
    const row = this.options.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    const value = row?.value as Partial<TechnitiumConnection> | undefined;
    if (!value?.url || !value.token) return null;
    return { url: value.url, token: value.token, tlsInsecure: value.tlsInsecure ?? false };
  }

  private connection(): TechnitiumConnection {
    const connection = this.options.envConnection ?? this.stored();
    if (!connection) throw new TechnitiumError('Technitium ist nicht verbunden', 'not-configured');
    return connection;
  }

  /** Ruft einen Technitium-Endpunkt mit der gespeicherten Verbindung auf. */
  call<T>(path: string, params?: Record<string, string | number | boolean>) {
    return callTechnitium<T>(this.connection(), path, params, this.options.timeoutMs);
  }

  /** Für DhcpService: ruft einen Endpunkt auf einem bestimmten Server auf (z. B. zweiter Knoten). */
  callWith<T>(
    connection: TechnitiumConnection,
    path: string,
    params?: Record<string, string | number | boolean>,
  ) {
    return callTechnitium<T>(connection, path, params, this.options.timeoutMs);
  }

  /** Hauptverbindung; wirft „nicht verbunden“, wenn keine eingerichtet ist. */
  mainConnection(): TechnitiumConnection {
    return this.connection();
  }

  get configured(): boolean {
    return Boolean(this.options.envConnection ?? this.stored());
  }

  getSettings(): TechnitiumSettings {
    if (this.options.envConnection) {
      const { url, tlsInsecure } = this.options.envConnection;
      return { url, hasToken: true, tlsInsecure, source: 'env' };
    }
    const stored = this.stored();
    return stored
      ? { url: stored.url, hasToken: true, tlsInsecure: stored.tlsInsecure, source: 'settings' }
      : { url: null, hasToken: false, tlsInsecure: false, source: null };
  }

  /** Ergänzt ein fehlendes Token aus den gespeicherten Einstellungen (Formular lässt es leer). */
  private resolveInput(raw: TechnitiumSettingsInput): TechnitiumConnection {
    const input = technitiumSettingsInput.parse(raw);
    const token = input.token ?? this.stored()?.token;
    if (!token) throw new TechnitiumError('Bitte ein API-Token angeben', 'not-configured');
    return { url: input.url, token, tlsInsecure: input.tlsInsecure };
  }

  async test(raw: TechnitiumSettingsInput): Promise<TechnitiumTestResult> {
    const connection = this.resolveInput(raw);
    const result = await callTechnitium<RawSettings>(
      connection,
      'settings/get',
      {},
      this.options.timeoutMs,
    );
    return { version: result.version, serverDomain: result.dnsServerDomain };
  }

  /** Speichert nur, wenn die Verbindung funktioniert. */
  async save(raw: TechnitiumSettingsInput, user: User): Promise<TechnitiumTestResult> {
    if (this.options.envConnection) {
      throw new TechnitiumError(
        'Die Verbindung ist über Umgebungsvariablen festgelegt und kann hier nicht geändert werden',
        'not-configured',
      );
    }
    const connection = this.resolveInput(raw);
    const result = await this.test(raw);
    this.options.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: connection })
      .onConflictDoUpdate({ target: settings.key, set: { value: connection } })
      .run();
    this.cache.clear();
    this.options.audit.record({
      user,
      action: 'technitium.connect',
      target: connection.url,
      ok: true,
    });
    return result;
  }

  disconnect(user: User) {
    this.options.db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
    this.cache.clear();
    this.options.audit.record({ user, action: 'technitium.disconnect', ok: true });
  }

  summary(range: StatsRange): Promise<DnsSummary> {
    const cached = this.cache.get(range);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const value = this.fetchSummary(range);
    this.cache.set(range, { at: Date.now(), value });
    // Fehler nicht zwischenspeichern, damit der nächste Aufruf es erneut versucht.
    value.catch(() => {
      if (this.cache.get(range)?.value === value) this.cache.delete(range);
    });
    return value;
  }

  private async fetchSummary(range: StatsRange): Promise<DnsSummary> {
    const [stats, config] = await Promise.all([
      this.call<RawStats>('dashboard/stats/get', { type: RANGE_TYPES[range], utc: true }),
      this.call<RawSettings>('settings/get'),
    ]);
    const s = stats.stats;
    const n = (key: string) => s[key] ?? 0;
    const dataset = (label: string) =>
      stats.mainChartData?.datasets?.find((d) => d.label === label)?.data ?? [];
    const queryTypeLabels = stats.queryTypeChartData?.labels ?? [];
    const queryTypeData = stats.queryTypeChartData?.datasets?.[0]?.data ?? [];

    return {
      range,
      fetchedAt: new Date().toISOString(),
      serverDomain: config.dnsServerDomain,
      version: config.version,
      totals: {
        queries: n('totalQueries'),
        blocked: n('totalBlocked'),
        cached: n('totalCached'),
        authoritative: n('totalAuthoritative'),
        recursive: n('totalRecursive'),
        dropped: n('totalDropped'),
        noError: n('totalNoError'),
        nxDomain: n('totalNxDomain'),
        serverFailure: n('totalServerFailure'),
        refused: n('totalRefused'),
        clients: n('totalClients'),
        zones: n('zones'),
      },
      series: {
        // Technitium liefert 7 Nachkommastellen, die nicht jeder Browser parsen kann.
        labels: (stats.mainChartData?.labels ?? []).map((label) =>
          label.replace(/\.(\d{3})\d*Z$/, '.$1Z'),
        ),
        queries: dataset('Total'),
        blocked: dataset('Blocked'),
      },
      queryTypes: queryTypeLabels
        .map((name, i) => ({ name, hits: queryTypeData[i] ?? 0 }))
        .filter((entry) => entry.hits > 0),
      topDomains: top(stats.topDomains),
      topBlocked: top(stats.topBlockedDomains),
      topClients: (stats.topClients ?? []).slice(0, 10).map(({ name, hits, domain }) => ({
        name,
        hits,
        domain: domain || null,
      })),
      blocking: this.blockingState(config, n('blockListZones') + n('blockedZones')),
    };
  }

  private blockingState(config: RawSettings, blockedDomains: number) {
    let pausedUntil: string | null = null;
    if (!config.enableBlocking) {
      const candidate = config.temporaryDisableBlockingTill ?? this.pausedUntil;
      if (candidate && Date.parse(candidate) > Date.now()) pausedUntil = candidate;
    }
    if (config.enableBlocking) this.pausedUntil = null;
    return {
      enabled: config.enableBlocking,
      pausedUntil,
      blockedDomains,
      listCount: config.blockListUrls?.length ?? 0,
      nextListUpdate: config.blockListNextUpdatedOn ?? null,
    };
  }

  async blocking(action: BlockingAction, user: User): Promise<void> {
    const details = action.action === 'pause' ? { minutes: action.minutes } : undefined;
    try {
      switch (action.action) {
        case 'pause': {
          const result = await this.call<{ temporaryDisableBlockingTill?: string }>(
            'settings/temporaryDisableBlocking',
            { minutes: action.minutes },
          );
          this.pausedUntil =
            result?.temporaryDisableBlockingTill ??
            new Date(Date.now() + action.minutes * 60_000).toISOString();
          break;
        }
        case 'enable':
        case 'disable':
          // Einschalten beendet auch eine laufende Pause.
          await this.call('settings/set', { enableBlocking: action.action === 'enable' });
          this.pausedUntil = null;
          break;
        case 'update-lists':
          await this.call('settings/forceUpdateBlockLists');
          break;
      }
      this.options.audit.record({
        user,
        action: `technitium.blocking.${action.action}`,
        details,
        ok: true,
      });
    } catch (error) {
      this.options.audit.record({
        user,
        action: `technitium.blocking.${action.action}`,
        details,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.cache.clear();
    }
  }
  async zones(): Promise<DnsZone[]> {
    const result = await this.call<{ zones: RawZone[] }>('zones/list');
    // Eigene Zonen zuerst, dann Reverse-Zonen, Technitium-interne zuletzt.
    const rank = (zone: DnsZone) => (zone.internal ? 2 : zone.name.endsWith('.arpa') ? 1 : 0);
    return result.zones
      .map(toZone)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  async records(zone: string): Promise<DnsRecordList> {
    const result = await this.call<{ zone: RawZone; records: RawRecord[] }>('zones/records/get', {
      domain: zone,
      zone,
      listZone: true,
    });
    return {
      zone: toZone(result.zone),
      // SOA und DNSSEC-Verwaltungseinträge sind für den Alltag nur Rauschen.
      records: result.records
        .filter(
          (record) =>
            !['SOA', 'RRSIG', 'DNSKEY', 'NSEC', 'NSEC3', 'NSEC3PARAM', 'DS'].includes(record.type),
        )
        .map(toRecord),
    };
  }

  /** Führt eine Änderung aus und protokolliert sie, auch wenn sie fehlschlägt. */
  async audited<T>(
    user: User,
    action: string,
    target: string,
    details: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await run();
      this.options.audit.record({ user, action, target, details, ok: true });
      return result;
    } catch (error) {
      this.options.audit.record({
        user,
        action,
        target,
        details,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async addRecord(raw: DnsRecordCreate, user: User): Promise<void> {
    const input = dnsRecordCreate.parse(raw);
    const hasPtr = input.data.type === 'A' || input.data.type === 'AAAA';
    await this.audited(
      user,
      'technitium.record.add',
      describeRecord(input.domain, input.data),
      { zone: input.zone, ttl: input.ttl },
      () =>
        this.call('zones/records/add', {
          zone: input.zone,
          domain: input.domain,
          type: input.data.type,
          ttl: input.ttl,
          ...(input.comments ? { comments: input.comments } : {}),
          ...(hasPtr && input.createPtr ? { ptr: true, createPtrZone: true } : {}),
          ...valueParams(input.data),
        }),
    );
  }

  async updateRecord(raw: DnsRecordUpdate, user: User): Promise<void> {
    const input = dnsRecordUpdate.parse(raw);
    if (input.current.data.type !== input.data.type)
      throw new TechnitiumError('Der Typ eines Eintrags lässt sich nicht ändern', 'api');
    const hasPtr = input.data.type === 'A' || input.data.type === 'AAAA';
    await this.audited(
      user,
      'technitium.record.update',
      describeRecord(input.current.domain, input.current.data),
      {
        zone: input.zone,
        to: describeRecord(input.domain, input.data),
        ttl: input.ttl,
        disabled: input.disabled,
      },
      () =>
        this.call('zones/records/update', {
          zone: input.zone,
          domain: input.current.domain,
          type: input.data.type,
          ...(input.domain !== input.current.domain ? { newDomain: input.domain } : {}),
          ttl: input.ttl,
          disable: input.disabled,
          comments: input.comments ?? '',
          ...(hasPtr && input.createPtr ? { ptr: true, createPtrZone: true } : {}),
          ...valueParams(input.current.data),
          ...newValueParams(input.data),
          // CNAME kennt kein „neu“: der Wert wird direkt gesetzt.
          ...(input.data.type === 'CNAME' ? { cname: input.data.cname } : {}),
        }),
    );
  }

  async deleteRecord(raw: DnsRecordDelete, user: User): Promise<void> {
    const input = dnsRecordDelete.parse(raw);
    await this.audited(
      user,
      'technitium.record.delete',
      describeRecord(input.domain, input.data),
      { zone: input.zone },
      () =>
        this.call('zones/records/delete', {
          zone: input.zone,
          domain: input.domain,
          type: input.data.type,
          ...deleteParams(input.data),
        }),
    );
  }
}

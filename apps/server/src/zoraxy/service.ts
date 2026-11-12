import { eq } from 'drizzle-orm';
import type {
  User,
  ZoraxySettings,
  ZoraxySettingsInput,
  ZoraxySummary,
  ZoraxyTestResult,
} from '@ultimate-dash/shared';
import { zoraxySettingsInput } from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { ZoraxyError, ZoraxySession, type ZoraxyConnection } from './client.js';
import { parseVersion, summarize } from './summary.js';

const SETTINGS_KEY = 'zoraxy';
/** So lange gilt ein Abruf; mehrere offene Dashboards teilen ihn sich. */
const CACHE_MS = 15_000;

export function zoraxyFromEnv(env = process.env): ZoraxyConnection | null {
  const url = env.ZORAXY_URL?.trim();
  const username = env.ZORAXY_USERNAME?.trim();
  const password = env.ZORAXY_PASSWORD;
  if (!url || !username || !password) return null;
  return {
    url: url.replace(/\/+$/, ''),
    username,
    password,
    tlsInsecure: env.ZORAXY_TLS_INSECURE === 'true',
  };
}

const sameConnection = (a: ZoraxyConnection, b: ZoraxyConnection) =>
  a.url === b.url &&
  a.username === b.username &&
  a.password === b.password &&
  a.tlsInsecure === b.tlsInsecure;

/** Holt alle Daten. Nur die Hostliste ist Pflicht; fehlt ein anderer Teil, bleibt der Rest sichtbar. */
async function fetchAll(session: ZoraxySession) {
  const hosts = await session.get<unknown>('/api/proxy/list', { type: 'host' });
  const warnings: string[] = [];
  const optional = async <T>(label: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (error) {
      // Ein abgelaufener Zugang soll nicht als Teilwarnung untergehen.
      if (error instanceof ZoraxyError && (error.kind === 'auth' || error.kind === 'unreachable'))
        throw error;
      warnings.push(`${label} konnten nicht gelesen werden`);
      return null;
    }
  };
  const [certificates, uptime, stats, info] = await Promise.all([
    optional('Zertifikate', () => session.get<unknown>('/api/cert/list', { date: 'true' })),
    optional('Uptime-Werte', () => session.get<unknown>('/api/utm/list')),
    optional('Anfrage-Zahlen', () => session.get<unknown>('/api/stats/summary')),
    session.get<unknown>('/api/info/x').catch(() => null),
  ]);
  return { hosts, certificates, uptime, stats, version: parseVersion(info), warnings };
}

export class ZoraxyService {
  private cache: { at: number; value: Promise<ZoraxySummary> } | null = null;
  private session: ZoraxySession | null = null;

  constructor(
    private readonly options: {
      db: Db;
      audit: AuditLog;
      envConnection?: ZoraxyConnection | null;
      timeoutMs?: number;
    },
  ) {}

  private stored(): ZoraxyConnection | null {
    const row = this.options.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    const value = row?.value as Partial<ZoraxyConnection> | undefined;
    if (!value?.url || !value.username || !value.password) return null;
    return {
      url: value.url,
      username: value.username,
      password: value.password,
      tlsInsecure: value.tlsInsecure ?? false,
    };
  }

  private connection(): ZoraxyConnection {
    const connection = this.options.envConnection ?? this.stored();
    if (!connection) throw new ZoraxyError('Zoraxy ist nicht verbunden', 'not-configured');
    return connection;
  }

  /** Die Sitzung wird wiederverwendet, solange sich die Zugangsdaten nicht ändern. */
  private sessionFor(connection: ZoraxyConnection): ZoraxySession {
    if (!this.session || !sameConnection(this.session.connection, connection)) {
      this.session = new ZoraxySession(connection, this.options.timeoutMs);
    }
    return this.session;
  }

  getSettings(): ZoraxySettings {
    const connection = this.options.envConnection ?? this.stored();
    if (!connection) {
      return { url: null, username: null, hasPassword: false, tlsInsecure: false, source: null };
    }
    return {
      url: connection.url,
      username: connection.username,
      hasPassword: true,
      tlsInsecure: connection.tlsInsecure,
      source: this.options.envConnection ? 'env' : 'settings',
    };
  }

  /** Ergänzt ein fehlendes Passwort aus den gespeicherten Einstellungen (Formular lässt es leer). */
  private resolveInput(raw: ZoraxySettingsInput): ZoraxyConnection {
    const input = zoraxySettingsInput.parse(raw);
    const stored = this.options.envConnection ?? this.stored();
    // Das gespeicherte Passwort gehört zum gespeicherten Benutzer, nicht zu einem anderen.
    const password =
      input.password ?? (stored?.username === input.username ? stored.password : undefined);
    if (!password) throw new ZoraxyError('Bitte das Passwort angeben', 'not-configured');
    return { url: input.url, username: input.username, password, tlsInsecure: input.tlsInsecure };
  }

  async test(raw: ZoraxySettingsInput): Promise<ZoraxyTestResult> {
    return this.check(this.resolveInput(raw));
  }

  private async check(connection: ZoraxyConnection): Promise<ZoraxyTestResult> {
    // Eigene Sitzung: Der Test darf eine laufende Verbindung nicht verändern.
    const data = await fetchAll(new ZoraxySession(connection, this.options.timeoutMs));
    const summary = summarize(data);
    return {
      version: summary.version,
      hosts: summary.counts.hosts,
      enabledHosts: summary.counts.enabled,
      certificates: summary.certificates.length,
      warnings: summary.warnings,
    };
  }

  /** Speichert nur, wenn die Verbindung funktioniert. */
  async save(raw: ZoraxySettingsInput, user: User): Promise<ZoraxyTestResult> {
    if (this.options.envConnection) {
      throw new ZoraxyError(
        'Die Verbindung ist über Umgebungsvariablen festgelegt und kann hier nicht geändert werden',
        'not-configured',
      );
    }
    const connection = this.resolveInput(raw);
    const result = await this.check(connection);
    this.options.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value: connection })
      .onConflictDoUpdate({ target: settings.key, set: { value: connection } })
      .run();
    this.reset();
    this.options.audit.record({ user, action: 'zoraxy.connect', target: connection.url, ok: true });
    return result;
  }

  disconnect(user: User) {
    this.options.db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
    this.reset();
    this.options.audit.record({ user, action: 'zoraxy.disconnect', ok: true });
  }

  private reset() {
    this.cache = null;
    this.session = null;
  }

  summary(): Promise<ZoraxySummary> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const session = this.sessionFor(this.connection());
    const value = fetchAll(session).then((data) => summarize(data));
    const entry = { at: Date.now(), value };
    this.cache = entry;
    // Fehler nicht zwischenspeichern, damit der nächste Aufruf es erneut versucht.
    value.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return value;
  }
}

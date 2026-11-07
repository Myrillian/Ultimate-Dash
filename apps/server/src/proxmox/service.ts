import { eq } from 'drizzle-orm';
import type {
  ProxmoxSettings,
  ProxmoxSettingsInput,
  ProxmoxSummary,
  ProxmoxTestResult,
  User,
} from '@ultimate-dash/shared';
import { proxmoxSettingsInput } from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { callProxmox, ProxmoxError, type ProxmoxConnection } from './client.js';
import {
  diskRates,
  summarize,
  type DiskCounters,
  type RawResource,
  type RawRrdPoint,
} from './summary.js';

const SETTINGS_KEY = 'proxmox';
/**
 * So lange gilt ein Abruf; mehrere offene Dashboards teilen ihn sich. Etwas kürzer als der
 * 10-Sekunden-Takt im Browser, damit jeder Takt frische Werte bekommt.
 */
const CACHE_MS = 8_000;

export function proxmoxFromEnv(env = process.env): ProxmoxConnection | null {
  const url = env.PROXMOX_URL?.trim();
  const tokenId = env.PROXMOX_TOKEN_ID?.trim();
  const secret = env.PROXMOX_TOKEN_SECRET?.trim();
  if (!url || !tokenId || !secret) return null;
  return {
    url: url.replace(/\/+$/, ''),
    tokenId,
    secret,
    tlsInsecure: env.PROXMOX_TLS_INSECURE === 'true',
  };
}

/** Rechte, die über reines Lesen hinausgehen (alles außer `*.Audit`). */
export function extraPrivileges(permissions: Record<string, Record<string, number>>): string[] {
  const extra = new Set<string>();
  for (const privileges of Object.values(permissions)) {
    for (const [name, granted] of Object.entries(privileges)) {
      if (granted && !name.endsWith('.Audit')) extra.add(name);
    }
  }
  return [...extra].sort();
}

const MISSING_ROLE =
  "Bitte die Rolle PVEAuditor auf „/“ dem Benutzer und dem Token vergeben (bei „Privilege Separation“ gilt nur, was beide haben): pveum acl modify / --users 'benutzer@realm' --roles PVEAuditor und pveum acl modify / --tokens 'benutzer@realm!token' --roles PVEAuditor";

/**
 * Fehlen dem Token Rechte, liefert Proxmox keinen Fehler: Ohne Sys.Audit erscheinen Knoten
 * nur mit Name und Status, ohne CPU und RAM; Gäste und Storages fehlen ganz.
 */
function requireNodes(resources: RawResource[]): RawResource[] {
  const nodes = Array.isArray(resources) ? resources.filter((r) => r.type === 'node') : [];
  if (nodes.length === 0) {
    throw new ProxmoxError(`Das Token sieht keinen Knoten. ${MISSING_ROLE}`, 'permission');
  }
  const online = nodes.filter((n) => n.status === 'online');
  if (online.length > 0 && online.every((n) => n.maxcpu === undefined)) {
    throw new ProxmoxError(
      `Das Token sieht den Knoten, aber keine Werte (CPU, RAM, VMs). ${MISSING_ROLE}`,
      'permission',
    );
  }
  return nodes;
}

export class ProxmoxService {
  private cache: { at: number; value: Promise<ProxmoxSummary> } | null = null;
  private counters: DiskCounters | null = null;

  constructor(
    private readonly options: {
      db: Db;
      audit: AuditLog;
      envConnection?: ProxmoxConnection | null;
      timeoutMs?: number;
    },
  ) {}

  private stored(): ProxmoxConnection | null {
    const row = this.options.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    const value = row?.value as Partial<ProxmoxConnection> | undefined;
    if (!value?.url || !value.tokenId || !value.secret) return null;
    return {
      url: value.url,
      tokenId: value.tokenId,
      secret: value.secret,
      tlsInsecure: value.tlsInsecure ?? false,
    };
  }

  private connection(): ProxmoxConnection {
    const connection = this.options.envConnection ?? this.stored();
    if (!connection) throw new ProxmoxError('Proxmox ist nicht verbunden', 'not-configured');
    return connection;
  }

  private call<T>(connection: ProxmoxConnection, path: string, query?: Record<string, string>) {
    return callProxmox<T>(connection, path, query, this.options.timeoutMs);
  }

  getSettings(): ProxmoxSettings {
    const connection = this.options.envConnection ?? this.stored();
    if (!connection) {
      return { url: null, tokenId: null, hasSecret: false, tlsInsecure: false, source: null };
    }
    return {
      url: connection.url,
      tokenId: connection.tokenId,
      hasSecret: true,
      tlsInsecure: connection.tlsInsecure,
      source: this.options.envConnection ? 'env' : 'settings',
    };
  }

  /** Ergänzt ein fehlendes Secret aus den gespeicherten Einstellungen (Formular lässt es leer). */
  private resolveInput(raw: ProxmoxSettingsInput): ProxmoxConnection {
    const input = proxmoxSettingsInput.parse(raw);
    const stored = this.options.envConnection ?? this.stored();
    // Das gespeicherte Secret gehört zur gespeicherten Token-ID, nicht zu einer anderen.
    const secret = input.secret ?? (stored?.tokenId === input.tokenId ? stored.secret : undefined);
    if (!secret) throw new ProxmoxError('Bitte das Secret des Tokens angeben', 'not-configured');
    return { url: input.url, tokenId: input.tokenId, secret, tlsInsecure: input.tlsInsecure };
  }

  async test(raw: ProxmoxSettingsInput): Promise<ProxmoxTestResult> {
    return this.check(this.resolveInput(raw));
  }

  private async check(connection: ProxmoxConnection): Promise<ProxmoxTestResult> {
    const [version, resources, permissions] = await Promise.all([
      this.call<{ version: string }>(connection, '/version'),
      this.call<RawResource[]>(connection, '/cluster/resources'),
      this.call<Record<string, Record<string, number>>>(connection, '/access/permissions'),
    ]);
    const nodes = requireNodes(resources).map((r) => r.node ?? r.id);
    const guests = resources.filter((r) => !r.template);
    return {
      version: version.version,
      nodes,
      vms: guests.filter((r) => r.type === 'qemu').length,
      containers: guests.filter((r) => r.type === 'lxc').length,
      extraPrivileges: extraPrivileges(permissions),
    };
  }

  /** Speichert nur, wenn die Verbindung funktioniert. */
  async save(raw: ProxmoxSettingsInput, user: User): Promise<ProxmoxTestResult> {
    if (this.options.envConnection) {
      throw new ProxmoxError(
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
    this.options.audit.record({
      user,
      action: 'proxmox.connect',
      target: connection.url,
      ok: true,
    });
    return result;
  }

  disconnect(user: User) {
    this.options.db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
    this.reset();
    this.options.audit.record({ user, action: 'proxmox.disconnect', ok: true });
  }

  private reset() {
    this.cache = null;
    this.counters = null;
  }

  summary(): Promise<ProxmoxSummary> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const value = this.fetchSummary(this.connection());
    const entry = { at: Date.now(), value };
    this.cache = entry;
    // Fehler nicht zwischenspeichern, damit der nächste Aufruf es erneut versucht.
    value.catch(() => {
      if (this.cache === entry) this.cache = null;
    });
    return value;
  }

  private async fetchSummary(connection: ProxmoxConnection): Promise<ProxmoxSummary> {
    const resources = await this.call<RawResource[]>(connection, '/cluster/resources');
    const now = Date.now();
    const online = requireNodes(resources).filter((r) => r.status === 'online');
    const rrd = new Map<string, RawRrdPoint[]>();
    await Promise.all(
      online.map(async (node) => {
        // Ohne Verlauf bleibt der Rest sichtbar, nur Netzwerk und Diagramm fehlen dann.
        const points = await this.call<RawRrdPoint[]>(
          connection,
          `/nodes/${encodeURIComponent(node.node!)}/rrddata`,
          { timeframe: 'hour', cf: 'AVERAGE' },
        ).catch(() => []);
        rrd.set(node.node!, points);
      }),
    );
    const { rates, counters } = diskRates(resources, this.counters, now);
    this.counters = counters;
    return summarize(resources, rrd, rates, new Date(now));
  }
}

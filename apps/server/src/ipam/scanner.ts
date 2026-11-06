import { eq } from 'drizzle-orm';
import {
  intToIpv4,
  ipamScanSettings,
  parseCidr,
  type IpamScanSettings,
  type IpamScanStatus,
  type User,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { IpamHostStore } from './hosts.js';
import type { Pinger } from './ping.js';
import type { IpamRepository } from './repository.js';

const KEY = 'ipam-scan';
const DEFAULTS: IpamScanSettings = { enabled: true, intervalMinutes: 30 };
/** Größere Netze als /22 werden nicht durchgepingt. */
export const MAX_SCAN_HOSTS = 1022;
const CONCURRENCY = 32;
const FIRST_RUN_DELAY_MS = 60_000;

/** Prüft regelmäßig per Ping, welche Adressen der Netze antworten, und merkt sich die Antworten. */
export class IpamScanner {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastRunAt: string | null = null;
  private nextRunAt: string | null = null;
  private lastDurationSeconds: number | null = null;
  private lastChecked: number | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly options: {
      db: Db;
      audit: AuditLog;
      repo: IpamRepository;
      hosts: IpamHostStore;
      ping: Pinger;
      onError?: (error: unknown) => void;
    },
  ) {}

  settings(): IpamScanSettings {
    const row = this.options.db.select().from(settings).where(eq(settings.key, KEY)).get();
    const parsed = ipamScanSettings.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULTS;
  }

  status(): IpamScanStatus {
    return {
      ...this.settings(),
      running: this.running,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.settings().enabled ? this.nextRunAt : null,
      lastDurationSeconds: this.lastDurationSeconds,
      lastChecked: this.lastChecked,
      lastError: this.lastError,
    };
  }

  save(raw: unknown, user: User): IpamScanStatus {
    const input = ipamScanSettings.parse(raw);
    this.options.db
      .insert(settings)
      .values({ key: KEY, value: input })
      .onConflictDoUpdate({ target: settings.key, set: { value: input } })
      .run();
    this.options.audit.record({
      user,
      action: 'ipam.scan.settings',
      target: input.enabled ? `alle ${input.intervalMinutes} Minuten` : 'aus',
      ok: true,
    });
    if (this.timer) this.schedule(FIRST_RUN_DELAY_MS);
    return this.status();
  }

  /** Startet den Zeitplan; der erste Durchlauf folgt kurz nach dem Start. */
  start(firstDelayMs = FIRST_RUN_DELAY_MS) {
    this.schedule(firstDelayMs);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number) {
    clearTimeout(this.timer);
    const { enabled, intervalMinutes } = this.settings();
    if (!enabled) {
      this.nextRunAt = null;
      this.timer = setTimeout(() => this.schedule(delayMs), 60_000);
      this.timer.unref();
      return;
    }
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.timer = setTimeout(() => {
      void this.run()
        .catch((error) => this.options.onError?.(error))
        .finally(() => this.schedule(intervalMinutes * 60_000));
    }, delayMs);
    this.timer.unref();
  }

  /** Ein Durchlauf über alle Netze mit Ping-Prüfung; läuft schon einer, passiert nichts. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    let checked = 0;
    this.lastError = null;
    try {
      for (const network of this.options.repo.all().networks) {
        const cidr = parseCidr(network.cidr);
        if (!network.scan || !cidr || cidr.size - 2 > MAX_SCAN_HOSTS) continue;
        const addresses: string[] = [];
        for (let n = cidr.first + 1; n < cidr.last; n++) addresses.push(intToIpv4(n));
        const results = await this.sweep(addresses);
        const at = new Date().toISOString();
        this.options.hosts.record(results, at);
        this.options.repo.markScanned(network.id, at);
        checked += addresses.length;
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
      this.lastChecked = checked;
      this.lastDurationSeconds = Math.round((Date.now() - started) / 100) / 10;
    }
  }

  /** Pingt höchstens CONCURRENCY Adressen gleichzeitig, damit das Netz nicht geflutet wird. */
  private async sweep(addresses: string[]): Promise<{ address: string; alive: boolean }[]> {
    const results = new Array<{ address: string; alive: boolean }>(addresses.length);
    let next = 0;
    const worker = async () => {
      while (next < addresses.length) {
        const i = next++;
        results[i] = { address: addresses[i]!, alive: await this.options.ping(addresses[i]!) };
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, addresses.length) }, worker));
    return results;
  }

  /** Startet einen Durchlauf im Hintergrund und kehrt sofort zurück. */
  runInBackground(user: User): IpamScanStatus {
    if (!this.running) {
      this.options.audit.record({ user, action: 'ipam.scan.run', ok: true });
      void this.run().catch((error) => this.options.onError?.(error));
      // `running` wird synchron in run() gesetzt, bevor das erste await folgt.
    }
    return this.status();
  }
}

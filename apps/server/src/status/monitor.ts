import type { Service, ServiceStatus } from '@ultimate-dash/shared';
import type { EventHub } from '../events.js';
import { checkUrl, type CheckOptions } from './check.js';

export interface MonitorOptions extends CheckOptions {
  intervalMs: number;
  concurrency?: number;
  listServices: () => Service[];
  events: EventHub;
  onError?: (error: unknown) => void;
}

/** Prüft regelmäßig alle Services und hält den letzten Status im Speicher. */
export class StatusMonitor {
  private statuses = new Map<number, ServiceStatus>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: MonitorOptions) {}

  start(): void {
    if (this.timer) return;
    void this.runAll();
    this.timer = setInterval(() => void this.runAll(), this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): ServiceStatus[] {
    return [...this.statuses.values()];
  }

  /** Entfernt Status von gelöschten oder nicht mehr geprüften Services. */
  forget(serviceId: number): void {
    this.statuses.delete(serviceId);
  }

  /** Prüft einen einzelnen Service sofort, z. B. nach dem Anlegen oder Bearbeiten. */
  async checkNow(service: Service): Promise<ServiceStatus | null> {
    if (!service.statusCheck) {
      this.forget(service.id);
      return null;
    }
    const status = await checkUrl(service.id, service.statusUrl ?? service.url, this.options);
    this.statuses.set(service.id, status);
    this.options.events.publish({ type: 'status', data: [status] });
    return status;
  }

  /** Ein Durchlauf über alle Services; überlappende Durchläufe werden zusammengelegt. */
  runAll(): Promise<void> {
    this.running ??= this.doRunAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRunAll(): Promise<void> {
    try {
      const all = this.options.listServices();
      const active = new Set(all.filter((s) => s.statusCheck).map((s) => s.id));
      for (const id of this.statuses.keys()) if (!active.has(id)) this.statuses.delete(id);

      const queue = all.filter((s) => s.statusCheck);
      const results: ServiceStatus[] = [];
      const workers = Array.from(
        { length: Math.min(this.options.concurrency ?? 8, queue.length) },
        async () => {
          for (let service = queue.shift(); service; service = queue.shift()) {
            const status = await checkUrl(
              service.id,
              service.statusUrl ?? service.url,
              this.options,
            );
            this.statuses.set(service.id, status);
            results.push(status);
          }
        },
      );
      await Promise.all(workers);
      if (results.length > 0) this.options.events.publish({ type: 'status', data: results });
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}

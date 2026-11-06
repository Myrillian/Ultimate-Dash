import type { BlockingAction, DnsSummary, StatsRange } from '@ultimate-dash/shared';
import { api, ApiError } from './api.js';

const RANGE_KEY = 'ud-dns-range';
const REFRESH_MS = 30_000;

function storedRange(): StatsRange {
  try {
    const value = localStorage.getItem(RANGE_KEY);
    if (value && ['hour', 'day', 'week', 'month', 'year'].includes(value))
      return value as StatsRange;
  } catch {
    // Speicher nicht verfügbar (privater Modus): Standard verwenden.
  }
  return 'day';
}

/** DNS-Statistik aus Technitium; lädt regelmäßig nach, solange die Seite sichtbar ist. */
class DnsState {
  range = $state<StatsRange>(storedRange());
  summary = $state<DnsSummary | null>(null);
  /** not-configured = noch keine Verbindung eingerichtet */
  status = $state<'idle' | 'loading' | 'ready' | 'not-configured' | 'error'>('idle');
  error = $state<string | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private requestId = 0;

  setRange(range: StatsRange) {
    this.range = range;
    try {
      localStorage.setItem(RANGE_KEY, range);
    } catch {
      // ignorieren
    }
    void this.load();
  }

  async load() {
    const id = ++this.requestId;
    const range = this.range;
    if (!this.summary) this.status = 'loading';
    try {
      const summary = await api.dnsSummary(range);
      if (id !== this.requestId) return;
      this.summary = summary;
      this.status = 'ready';
      this.error = null;
    } catch (error) {
      if (id !== this.requestId) return;
      if (error instanceof ApiError && error.code === 'not-configured') {
        this.summary = null;
        this.status = 'not-configured';
      } else {
        this.status = 'error';
        this.error = error instanceof Error ? error.message : 'DNS-Statistik nicht verfügbar';
      }
    }
  }

  async blocking(action: BlockingAction) {
    await api.blocking(action);
    await this.load();
  }

  start() {
    void this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.status !== 'not-configured')
        void this.load();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.status !== 'not-configured')
      void this.load();
  };
}

export const dns = new DnsState();

import type { ProxmoxSummary } from '@ultimate-dash/shared';
import { api, ApiError } from './api.js';

const VIEW_KEY = 'ud-proxmox-view';
const REFRESH_MS = 10_000;

/** Größe des Proxmox-Bereichs: einzeiliger Balken oder kompakte Kacheln. */
export type ProxmoxView = 'bar' | 'compact';

function storedView(): ProxmoxView {
  try {
    if (localStorage.getItem(VIEW_KEY) === 'compact') return 'compact';
  } catch {
    // Speicher nicht verfügbar (privater Modus): Standard verwenden.
  }
  return 'bar';
}

/** Kennzahlen des Proxmox-Hosts; lädt regelmäßig nach, solange die Seite sichtbar ist. */
class ProxmoxState {
  view = $state<ProxmoxView>(storedView());
  summary = $state<ProxmoxSummary | null>(null);
  status = $state<'idle' | 'loading' | 'ready' | 'not-configured' | 'error'>('idle');
  error = $state<string | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private followUp: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  setView(view: ProxmoxView) {
    this.view = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignorieren
    }
  }

  async load() {
    const id = ++this.requestId;
    if (!this.summary) this.status = 'loading';
    try {
      const summary = await api.proxmoxSummary();
      if (id !== this.requestId) return;
      this.summary = summary;
      this.status = 'ready';
      this.error = null;
      // Der Disk-Durchsatz braucht zwei Abrufe; den zweiten nicht erst im nächsten Takt holen.
      if (!summary.diskIo && !this.followUp && this.timer)
        this.followUp = setTimeout(() => {
          this.followUp = undefined;
          void this.load();
        }, 9_000);
    } catch (error) {
      if (id !== this.requestId) return;
      if (error instanceof ApiError && error.code === 'not-configured') {
        this.summary = null;
        this.status = 'not-configured';
      } else {
        this.status = 'error';
        this.error = error instanceof Error ? error.message : 'Proxmox nicht verfügbar';
      }
    }
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
    this.timer = undefined;
    clearTimeout(this.followUp);
    this.followUp = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.status !== 'not-configured')
      void this.load();
  };
}

export const proxmox = new ProxmoxState();

import type { ZoraxySummary } from '@ultimate-dash/shared';
import { api, ApiError } from './api.js';

const VIEW_KEY = 'ud-zoraxy-view';
const REFRESH_MS = 15_000;

/** Größe des Zoraxy-Bereichs: einzeiliger Balken oder Liste der Hosts. */
export type ZoraxyView = 'bar' | 'list';

function storedView(): ZoraxyView {
  try {
    if (localStorage.getItem(VIEW_KEY) === 'list') return 'list';
  } catch {
    // Speicher nicht verfügbar (privater Modus): Standard verwenden.
  }
  return 'bar';
}

/** Hosts und Kennzahlen von Zoraxy; lädt regelmäßig nach, solange die Seite sichtbar ist. */
class ZoraxyState {
  view = $state<ZoraxyView>(storedView());
  summary = $state<ZoraxySummary | null>(null);
  status = $state<'idle' | 'loading' | 'ready' | 'not-configured' | 'error'>('idle');
  error = $state<string | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private requestId = 0;

  setView(view: ZoraxyView) {
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
      const summary = await api.zoraxySummary();
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
        this.error = error instanceof Error ? error.message : 'Zoraxy nicht verfügbar';
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
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.status !== 'not-configured')
      void this.load();
  };
}

export const zoraxy = new ZoraxyState();

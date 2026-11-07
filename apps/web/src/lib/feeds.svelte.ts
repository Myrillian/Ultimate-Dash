import type { FeedItem } from '@ultimate-dash/shared';
import { api } from './api.js';

const PAGE = 30;
const PREFS_KEY = 'ud.news';
/** Ab dieser Breite steht die Leiste rechts, darunter der Bereich unter den Gruppen (Tailwind xl). */
const WIDE_QUERY = '(min-width: 80rem)';

interface Prefs {
  topic: string | null;
  /** Seitenleiste auf breiten Bildschirmen eingeklappt. */
  sidebarCollapsed: boolean;
  /** Bereich unter den Gruppen auf schmalen Bildschirmen eingeklappt. */
  sectionCollapsed: boolean;
  /** Neuigkeiten ganz ausgeblendet. */
  hidden: boolean;
  /** Wann der Benutzer die Meldungen zuletzt gesehen hat. */
  seenAt: string;
}

const defaults = (): Prefs => ({
  topic: null,
  sidebarCollapsed: false,
  sectionCollapsed: true,
  hidden: false,
  // Beim allerersten Besuch gilt nichts als „neu“.
  seenAt: new Date().toISOString(),
});

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // Speicher nicht verfügbar (privater Modus): Standard verwenden.
  }
  return defaults();
}

/** RSS-Meldungen für Seitenleiste und Bereich unter den Gruppen; Einstellungen je Browser. */
class NewsState {
  items = $state<FeedItem[]>([]);
  topics = $state<string[]>([]);
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state<string | null>(null);
  hasMore = $state(false);
  loadingMore = $state(false);
  prefs = $state<Prefs>(readPrefs());
  /** Meldungen nach diesem Zeitpunkt bekommen einen „neu“-Punkt (Stand beim Öffnen). */
  highlightSince = $state(this.prefs.seenAt);

  /** Zahl der Meldungen, die seit dem letzten Hinsehen dazugekommen sind. */
  unseen = $derived(this.items.filter((item) => item.fetchedAt > this.prefs.seenAt).length);

  private request = 0;

  constructor() {
    if (this.visible()) this.markSeen();
  }

  isNew(item: FeedItem): boolean {
    return item.fetchedAt > this.highlightSince;
  }

  private save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // ignorieren
    }
  }

  private update(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch };
    this.save();
  }

  /** Ist die Liste gerade aufgeklappt zu sehen? */
  private visible(): boolean {
    if (this.prefs.hidden || typeof window === 'undefined') return false;
    const wide = window.matchMedia?.(WIDE_QUERY).matches ?? true;
    return wide ? !this.prefs.sidebarCollapsed : !this.prefs.sectionCollapsed;
  }

  private markSeen() {
    this.highlightSince = this.prefs.seenAt;
    this.update({ seenAt: new Date().toISOString() });
  }

  async load(): Promise<void> {
    if (this.prefs.hidden) return;
    const request = ++this.request;
    if (this.status !== 'ready') this.status = 'loading';
    try {
      const page = await api.feedItems({ topic: this.prefs.topic ?? undefined, limit: PAGE });
      if (request !== this.request) return;
      this.items = page.items;
      this.topics = page.topics;
      this.hasMore = page.items.length === PAGE;
      this.status = 'ready';
      this.error = null;
      // Ein gewähltes Thema, das es nicht mehr gibt, zurücksetzen.
      if (this.prefs.topic && !page.topics.includes(this.prefs.topic)) {
        this.update({ topic: null });
        return this.load();
      }
      // Wer die Liste offen hat, sieht neue Meldungen sofort: dann gelten sie als gesehen,
      // behalten aber ihren Punkt bis zum nächsten Öffnen.
      if (this.visible()) this.update({ seenAt: new Date().toISOString() });
    } catch (error) {
      if (request !== this.request) return;
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Meldungen nicht ladbar';
    }
  }

  async loadMore() {
    const last = this.items.at(-1);
    if (!last || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await api.feedItems({
        topic: this.prefs.topic ?? undefined,
        before: last.publishedAt,
        limit: PAGE,
      });
      const known = new Set(this.items.map((item) => item.id));
      this.items = [...this.items, ...page.items.filter((item) => !known.has(item.id))];
      this.hasMore = page.items.length === PAGE;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Meldungen nicht ladbar';
    } finally {
      this.loadingMore = false;
    }
  }

  setTopic(topic: string | null) {
    if (topic === this.prefs.topic) return;
    this.update({ topic });
    void this.load();
  }

  setSidebarCollapsed(collapsed: boolean) {
    this.update({ sidebarCollapsed: collapsed });
    if (!collapsed) this.markSeen();
  }

  setSectionCollapsed(collapsed: boolean) {
    this.update({ sectionCollapsed: collapsed });
    if (!collapsed) this.markSeen();
  }

  setHidden(hidden: boolean) {
    this.update({ hidden });
    if (!hidden) {
      if (this.visible()) this.markSeen();
      void this.load();
    }
  }
}

export const news = new NewsState();

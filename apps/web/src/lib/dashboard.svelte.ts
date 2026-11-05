import type { DashboardData, ServerEvent, ServiceStatus } from '@ultimate-dash/shared';
import { api } from './api.js';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/** Zentraler Zustand: Dashboard-Daten plus Live-Status per Server-Sent Events. */
class DashboardState {
  data = $state<DashboardData | null>(null);
  error = $state<string | null>(null);
  statuses = $state<Record<number, ServiceStatus>>({});
  connection = $state<ConnectionState>('connecting');

  private source: EventSource | null = null;

  async load() {
    try {
      this.data = await api.dashboard();
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Dashboard konnte nicht geladen werden';
    }
  }

  connect() {
    if (this.source) return;
    // EventSource verbindet sich nach Abbrüchen selbstständig neu.
    const source = new EventSource('/api/events');
    this.source = source;
    source.onopen = () => {
      this.connection = 'live';
      // Nach einem Verbindungsabbruch könnten Änderungen verpasst worden sein.
      void this.load();
    };
    source.onerror = () => {
      this.connection = source.readyState === EventSource.CLOSED ? 'offline' : 'connecting';
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as ServerEvent;
      if (event.type === 'status') {
        const next = { ...this.statuses };
        for (const status of event.data) next[status.serviceId] = status;
        this.statuses = next;
      } else if (event.type === 'dashboard-changed') {
        void this.load();
      }
    };
  }

  disconnect() {
    this.source?.close();
    this.source = null;
  }
}

export const dashboard = new DashboardState();

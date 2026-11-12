import type { UpdateStatus } from '@ultimate-dash/shared';
import { api } from './api';

/** Stand der Update-Prüfung; gilt nur für Admins (die API verweigert sie anderen). */
class UpdateState {
  status = $state<UpdateStatus | null>(null);
  error = $state<string | null>(null);
  loading = $state(false);

  get available(): boolean {
    return !!this.status?.updateAvailable;
  }

  async load(force = false): Promise<UpdateStatus | null> {
    this.loading = true;
    try {
      this.status = await (force ? api.checkUpdate() : api.updateStatus());
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Unbekannter Fehler';
    } finally {
      this.loading = false;
    }
    return this.status;
  }

  /** Während des Neustarts antwortet der Server kurz nicht: still null statt Fehlermeldung. */
  async poll(): Promise<UpdateStatus | null> {
    try {
      this.status = await api.updateStatus();
      this.error = null;
      return this.status;
    } catch {
      return null;
    }
  }
}

export const updates = new UpdateState();

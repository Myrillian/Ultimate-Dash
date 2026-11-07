export type ServiceState = 'up' | 'down' | 'unknown';

export interface ServiceStatus {
  serviceId: number;
  state: ServiceState;
  /** HTTP-Statuscode der letzten Prüfung, falls eine Antwort kam. */
  httpStatus: number | null;
  /** Antwortzeit in Millisekunden. */
  latencyMs: number | null;
  /** Fehlermeldung bei `down`, z. B. "Zeitüberschreitung". */
  error: string | null;
  checkedAt: string;
}

/** Ereignisse, die der Server per Server-Sent Events an den Browser schickt. */
export type ServerEvent =
  | { type: 'status'; data: ServiceStatus[] }
  | { type: 'dashboard-changed' }
  /** Neue RSS-Meldungen oder geänderte Feeds; betrifft alle Benutzer. */
  | { type: 'feeds-changed' };

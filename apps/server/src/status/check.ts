import { Agent } from 'undici';
import type { ServiceStatus } from '@ultimate-dash/shared';

/**
 * Im Homelab haben viele Dienste selbst signierte Zertifikate. Die Statusprüfung
 * liest nur den Statuscode und sendet keine Zugangsdaten, daher werden
 * Zertifikatsfehler hier toleriert.
 */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface CheckOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Erreichbar heißt: Antwort unter 400, oder 401/403 (Dienst läuft, verlangt aber Login). */
export function isReachable(httpStatus: number): boolean {
  return httpStatus < 400 || httpStatus === 401 || httpStatus === 403;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Zeitüberschreitung';
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    switch (cause?.code) {
      case 'ECONNREFUSED':
        return 'Verbindung abgelehnt';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'Hostname nicht auflösbar';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'Host nicht erreichbar';
      case 'ECONNRESET':
        return 'Verbindung zurückgesetzt';
      default:
        return cause?.code ?? cause?.message ?? error.message;
    }
  }
  return 'Unbekannter Fehler';
}

/** Prüft eine URL per HEAD und fällt auf GET zurück, wenn HEAD nicht unterstützt wird. */
export async function checkUrl(
  serviceId: number,
  url: string,
  { timeoutMs, fetchImpl = fetch }: CheckOptions,
): Promise<ServiceStatus> {
  const started = performance.now();
  const request = (method: 'HEAD' | 'GET') =>
    fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'UltimateDash-StatusCheck' },
      // @ts-expect-error dispatcher ist eine undici-Erweiterung von fetch
      dispatcher: insecureAgent,
    });

  try {
    let response = await request('HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await request('GET');
    }
    // Body verwerfen, damit die Verbindung freigegeben wird.
    await response.body?.cancel().catch(() => undefined);
    const reachable = isReachable(response.status);
    return {
      serviceId,
      state: reachable ? 'up' : 'down',
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - started),
      error: reachable ? null : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      serviceId,
      state: 'down',
      httpStatus: null,
      latencyMs: null,
      error: describeError(error),
      checkedAt: new Date().toISOString(),
    };
  }
}

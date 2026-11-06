import { Agent, fetch as undiciFetch } from 'undici';

export interface TechnitiumConnection {
  url: string;
  token: string;
  tlsInsecure: boolean;
}

export type TechnitiumErrorKind = 'not-configured' | 'auth' | 'permission' | 'unreachable' | 'api';

/** Fehler beim Gespräch mit Technitium, mit einer Meldung, die man in der Oberfläche zeigen kann. */
export class TechnitiumError extends Error {
  constructor(
    message: string,
    readonly kind: TechnitiumErrorKind,
  ) {
    super(message);
  }

  /** HTTP-Status für unsere eigene API */
  get statusCode(): number {
    return this.kind === 'not-configured' ? 409 : 502;
  }
}

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const secureAgent = new Agent();

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return 'Technitium antwortet nicht (Zeitüberschreitung)';
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    switch (cause?.code) {
      case 'ECONNREFUSED':
        return 'Technitium lehnt die Verbindung ab. Stimmen Adresse und Port (meist 5380)?';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'Der Hostname von Technitium lässt sich nicht auflösen';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'Technitium ist im Netz nicht erreichbar';
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
      case 'CERT_HAS_EXPIRED':
        return 'Das Zertifikat von Technitium ist nicht vertrauenswürdig. Bei einem selbst signierten Zertifikat „Zertifikat nicht prüfen“ aktivieren.';
      default:
        if (cause?.code) return `Technitium nicht erreichbar (${cause.code})`;
    }
  }
  return 'Technitium nicht erreichbar';
}

/**
 * Ruft einen Endpunkt der Technitium-HTTP-API auf. Parameter gehen als Formulardaten per POST,
 * damit das Token nicht in Zugriffslogs landet. Es wird zusätzlich als `token` mitgeschickt,
 * weil Versionen vor 15.0 den Authorization-Header nicht kennen.
 */
export async function callTechnitium<T>(
  connection: TechnitiumConnection,
  path: string,
  params: Record<string, string | number | boolean> = {},
  timeoutMs = 8000,
): Promise<T> {
  const body = new URLSearchParams({ token: connection.token });
  for (const [key, value] of Object.entries(params)) body.set(key, String(value));

  let response;
  try {
    response = await undiciFetch(`${connection.url}/api/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'UltimateDash',
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: connection.tlsInsecure ? insecureAgent : secureAgent,
    });
  } catch (error) {
    throw new TechnitiumError(describeNetworkError(error), 'unreachable');
  }

  const data = (await response.json().catch(() => null)) as {
    status?: string;
    errorMessage?: string;
    response?: T;
  } | null;
  if (!data || typeof data.status !== 'string') {
    throw new TechnitiumError(
      `Unter dieser Adresse antwortet kein Technitium DNS Server (HTTP ${response.status})`,
      'unreachable',
    );
  }
  switch (data.status) {
    case 'ok':
      return data.response as T;
    case 'invalid-token':
      throw new TechnitiumError('Das API-Token ist ungültig oder abgelaufen', 'auth');
    case '2fa-required':
      throw new TechnitiumError(
        'Technitium verlangt eine Zwei-Faktor-Anmeldung. Bitte ein API-Token verwenden.',
        'auth',
      );
    default: {
      const message = data.errorMessage ?? 'Unbekannter Fehler';
      if (/access was denied/i.test(message)) {
        throw new TechnitiumError(
          'Das API-Token hat dafür keine Berechtigung in Technitium',
          'permission',
        );
      }
      throw new TechnitiumError(`Technitium meldet: ${message}`, 'api');
    }
  }
}

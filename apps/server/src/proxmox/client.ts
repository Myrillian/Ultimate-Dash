import { Agent, fetch as undiciFetch } from 'undici';

export interface ProxmoxConnection {
  url: string;
  tokenId: string;
  secret: string;
  tlsInsecure: boolean;
}

export type ProxmoxErrorKind = 'not-configured' | 'auth' | 'permission' | 'unreachable' | 'api';

/** Fehler beim Gespräch mit Proxmox, mit einer Meldung für die Oberfläche. */
export class ProxmoxError extends Error {
  constructor(
    message: string,
    readonly kind: ProxmoxErrorKind,
  ) {
    super(message);
  }

  get statusCode(): number {
    return this.kind === 'not-configured' ? 409 : 502;
  }
}

/**
 * Die einzigen Pfade, die Ultimate Dash bei Proxmox abfragt. Zusammen mit „nur GET“ ist so
 * ausgeschlossen, dass der Server etwas verändert, selbst wenn das Token mehr dürfte.
 */
const ALLOWED_PATHS = [
  /^\/version$/,
  /^\/cluster\/resources$/,
  /^\/access\/permissions$/,
  /^\/nodes\/[A-Za-z0-9.-]+\/rrddata$/,
];

export const isAllowedPath = (path: string) => ALLOWED_PATHS.some((pattern) => pattern.test(path));

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const secureAgent = new Agent();

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return 'Proxmox antwortet nicht (Zeitüberschreitung)';
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    switch (cause?.code) {
      case 'ECONNREFUSED':
        return 'Proxmox lehnt die Verbindung ab. Stimmen Adresse und Port (meist 8006)?';
      case 'ECONNRESET':
        return 'Proxmox hat die Verbindung beendet. Die Adresse muss mit https:// beginnen.';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'Der Hostname von Proxmox lässt sich nicht auflösen';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'Proxmox ist im Netz nicht erreichbar';
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
      case 'CERT_HAS_EXPIRED':
        return 'Das Zertifikat von Proxmox ist nicht vertrauenswürdig. Bei einem selbst signierten Zertifikat „Zertifikat nicht prüfen“ aktivieren.';
      default:
        if (cause?.code) return `Proxmox nicht erreichbar (${cause.code})`;
    }
  }
  return 'Proxmox nicht erreichbar';
}

/**
 * Liest einen Endpunkt der Proxmox-API (`/api2/json`). Es gibt bewusst nur GET und nur die
 * Pfade aus der Liste oben. Das Token geht im Authorization-Header, nie in der Adresse.
 */
export async function callProxmox<T>(
  connection: ProxmoxConnection,
  path: string,
  query: Record<string, string> = {},
  timeoutMs = 8000,
): Promise<T> {
  if (!isAllowedPath(path)) throw new Error(`Proxmox-Pfad nicht erlaubt: ${path}`);
  const search = new URLSearchParams(query).toString();

  let response;
  try {
    response = await undiciFetch(
      `${connection.url}/api2/json${path}${search ? `?${search}` : ''}`,
      {
        method: 'GET',
        headers: {
          authorization: `PVEAPIToken=${connection.tokenId}=${connection.secret}`,
          accept: 'application/json',
          'user-agent': 'UltimateDash',
        },
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: connection.tlsInsecure ? insecureAgent : secureAgent,
      },
    );
  } catch (error) {
    throw new ProxmoxError(describeNetworkError(error), 'unreachable');
  }

  if (response.status === 401) {
    throw new ProxmoxError(
      'Token-ID oder Secret sind falsch, oder das Token ist abgelaufen',
      'auth',
    );
  }
  if (response.status === 403) {
    throw new ProxmoxError(
      'Dem Token fehlen Rechte. Bitte die Rolle PVEAuditor auf „/“ für das Token vergeben.',
      'permission',
    );
  }
  const data = (await response.json().catch(() => null)) as { data?: T } | null;
  if (!response.ok) {
    throw new ProxmoxError(`Proxmox meldet einen Fehler (HTTP ${response.status})`, 'api');
  }
  if (!data || !('data' in data)) {
    throw new ProxmoxError(
      `Unter dieser Adresse antwortet kein Proxmox VE (HTTP ${response.status})`,
      'unreachable',
    );
  }
  return data.data as T;
}

import { Agent, fetch as undiciFetch, type Response } from 'undici';

export interface ZoraxyConnection {
  url: string;
  username: string;
  password: string;
  tlsInsecure: boolean;
}

export type ZoraxyErrorKind = 'not-configured' | 'auth' | 'unreachable' | 'api';

/** Fehler beim Gespräch mit Zoraxy, mit einer Meldung für die Oberfläche. */
export class ZoraxyError extends Error {
  constructor(
    message: string,
    readonly kind: ZoraxyErrorKind,
  ) {
    super(message);
  }

  get statusCode(): number {
    return this.kind === 'not-configured' ? 409 : 502;
  }
}

/**
 * Die einzigen Pfade, die Ultimate Dash bei Zoraxy abfragt, und das nur per GET. Zoraxy kennt
 * keine API-Tokens, das Konto hat daher Vollzugriff; diese Liste stellt sicher, dass der Server
 * trotzdem nichts verändert. Einzige Ausnahme ist die Anmeldung selbst (POST, fester Pfad).
 */
const ALLOWED_PATHS = [
  /^\/api\/info\/x$/,
  /^\/api\/proxy\/list$/,
  /^\/api\/cert\/list$/,
  /^\/api\/utm\/list$/,
  /^\/api\/stats\/summary$/,
];

export const isAllowedPath = (path: string) => ALLOWED_PATHS.some((pattern) => pattern.test(path));

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const secureAgent = new Agent();

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return 'Zoraxy antwortet nicht (Zeitüberschreitung)';
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    switch (cause?.code) {
      case 'ECONNREFUSED':
        return 'Zoraxy lehnt die Verbindung ab. Stimmen Adresse und Port der Verwaltungsoberfläche?';
      case 'ECONNRESET':
      case 'ERR_SSL_WRONG_VERSION_NUMBER':
        return 'Zoraxy hat die Verbindung beendet. Passen http:// bzw. https:// zur Adresse?';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'Der Hostname von Zoraxy lässt sich nicht auflösen';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'Zoraxy ist im Netz nicht erreichbar';
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
      case 'CERT_HAS_EXPIRED':
        return 'Das Zertifikat von Zoraxy ist nicht vertrauenswürdig. Bei einem selbst signierten Zertifikat „Zertifikat nicht prüfen“ aktivieren.';
      default:
        if (cause?.code) return `Zoraxy nicht erreichbar (${cause.code})`;
    }
  }
  return 'Zoraxy nicht erreichbar';
}

/** Name=Wert-Paare aus den Set-Cookie-Kopfzeilen einer Antwort. */
function readCookies(response: Response): [string, string][] {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0]!)
    .map((pair): [string, string] => {
      const at = pair.indexOf('=');
      return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    })
    .filter(([name]) => name);
}

/**
 * Eine angemeldete Sitzung bei Zoraxy: Cookie (und, falls Zoraxy eines verlangt, das
 * CSRF-Token aus der Startseite) werden im Speicher gehalten und bei Ablauf (401/403)
 * einmal automatisch erneuert. Zugangsdaten und Cookie verlassen den Server nie.
 */
export class ZoraxySession {
  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  private loggedIn = false;

  constructor(
    readonly connection: ZoraxyConnection,
    private readonly timeoutMs = 8000,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    return {
      accept: 'application/json',
      'user-agent': 'UltimateDash',
      ...(cookie ? { cookie } : {}),
      ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
      ...extra,
    };
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; form?: Record<string, string> } = {},
  ): Promise<Response> {
    const search = new URLSearchParams(options.query ?? {}).toString();
    try {
      const response = await undiciFetch(
        `${this.connection.url}${path}${search ? `?${search}` : ''}`,
        {
          method,
          headers: this.headers(
            options.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
          ),
          body: options.form ? new URLSearchParams(options.form).toString() : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
          dispatcher: this.connection.tlsInsecure ? insecureAgent : secureAgent,
          redirect: 'manual',
        },
      );
      for (const [name, value] of readCookies(response)) this.cookies.set(name, value);
      return response;
    } catch (error) {
      throw new ZoraxyError(describeNetworkError(error), 'unreachable');
    }
  }

  /** Meldet sich an und holt, falls vorhanden, das CSRF-Token der Verwaltungsoberfläche. */
  private async login(): Promise<void> {
    this.cookies.clear();
    this.csrf = null;
    this.loggedIn = false;
    const response = await this.send('POST', '/api/auth/login', {
      form: {
        username: this.connection.username,
        password: this.connection.password,
        rmbme: 'true',
      },
    });
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403 || /"error"\s*:/.test(body)) {
      throw new ZoraxyError('Benutzername oder Passwort von Zoraxy sind falsch', 'auth');
    }
    if (!response.ok) {
      throw new ZoraxyError(
        `Zoraxy meldet einen Fehler bei der Anmeldung (HTTP ${response.status})`,
        'api',
      );
    }
    // Zoraxy bettet das CSRF-Token als <meta name="zoraxy.csrf.Token"> in die Startseite ein.
    const home = await this.send('GET', '/');
    const html = await home.text().catch(() => '');
    const meta = /<meta[^>]*name=["']zoraxy\.csrf\.Token["'][^>]*>/i.exec(html)?.[0];
    this.csrf = meta ? (/content=["']([^"']*)["']/i.exec(meta)?.[1] ?? null) : null;
    this.loggedIn = true;
  }

  /** Liest einen Endpunkt als JSON. Nur GET und nur Pfade aus der Liste oben. */
  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    if (!isAllowedPath(path)) throw new Error(`Zoraxy-Pfad nicht erlaubt: ${path}`);
    // /api/info/x braucht keine Anmeldung.
    if (!this.loggedIn && path !== '/api/info/x') await this.login();
    const denied = (status: number) =>
      status === 401 || status === 403 || (status >= 300 && status < 400);
    let response = await this.send('GET', path, { query });
    // Ohne gültige Sitzung antwortet Zoraxy mit 401 oder leitet auf die Anmeldeseite um.
    if (denied(response.status) && path !== '/api/info/x') {
      await this.login();
      response = await this.send('GET', path, { query });
    }
    if (denied(response.status)) {
      throw new ZoraxyError(
        'Zoraxy lehnt den Zugriff ab. Sind Benutzername und Passwort richtig?',
        'auth',
      );
    }
    if (!response.ok) {
      throw new ZoraxyError(`Zoraxy meldet einen Fehler (HTTP ${response.status})`, 'api');
    }
    const body = await response.text();
    try {
      const data = JSON.parse(body) as unknown;
      if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
        throw new ZoraxyError(
          `Zoraxy meldet: ${String((data as { error: unknown }).error)}`,
          'api',
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof ZoraxyError) throw error;
      throw new ZoraxyError(
        `Unter dieser Adresse antwortet keine Zoraxy-Verwaltungsoberfläche (HTTP ${response.status})`,
        'unreachable',
      );
    }
  }
}

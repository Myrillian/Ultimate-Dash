import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Simulierter Zoraxy für Tests und lokale Entwicklung. Bildet die Anmeldung (Cookie plus
 * CSRF-Token aus der Startseite) und die lesenden Endpunkte nach, die Ultimate Dash nutzt.
 * Die Formate folgen dem Quellcode von Zoraxy und sind nicht gegen jede Version geprüft.
 */
export interface FakeZoraxy {
  url: string;
  username: string;
  password: string;
  /** Tests dürfen den Stand lesen und verändern */
  hosts: unknown[];
  certificates: unknown[];
  uptime: unknown;
  stats: unknown;
  /** Endpunkte, die mit HTTP 500 antworten sollen */
  failing: Set<string>;
  /** Gültige Sitzungen; leeren simuliert einen Neustart von Zoraxy */
  sessions: Set<string>;
  logins: number;
  requests: { method: string; path: string; search: string }[];
  close(): Promise<void>;
}

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

const host = (
  domain: string,
  targets: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  RootOrMatchingDomain: domain,
  MatchingDomainAlias: [],
  ActiveOrigins: targets.map((t) => ({ OriginIpOrDomain: t, RequireTLS: false, Weight: 1 })),
  InactiveOrigins: [],
  Disabled: false,
  Tags: [],
  AuthenticationProvider: {
    AuthMethod: 1,
    BasicAuthCredentials: [{ Username: 'admin', PasswordHash: '' }],
  },
  ...extra,
});

const seed = () => ({
  hosts: [
    host('nextcloud.example.org', ['192.168.1.20:8080'], { Tags: ['cloud'] }),
    host('ha.example.org', ['192.168.1.30:8123'], { MatchingDomainAlias: ['home.example.org'] }),
    host('wiki.example.org', ['192.168.1.40:3000']),
    host('alt.example.org', ['192.168.1.99:80'], { Disabled: true }),
  ],
  certificates: [
    {
      Domain: '_.example.org',
      LastModifiedDate: isoDay(-60),
      ExpireDate: isoDay(30),
      RemainingDays: 30,
    },
    {
      Domain: 'wiki.example.org',
      LastModifiedDate: isoDay(-80),
      ExpireDate: isoDay(5),
      RemainingDays: 5,
    },
  ] as unknown[],
  uptime: {
    'nextcloud.example.org': [
      {
        Timestamp: 1,
        ID: 'a',
        Name: 'nextcloud',
        URL: 'https://nextcloud.example.org',
        Online: true,
      },
    ],
    'ha.example.org': [
      { Timestamp: 1, ID: 'b', Name: 'ha', URL: 'https://ha.example.org', Online: true },
    ],
    'wiki.example.org': [
      { Timestamp: 1, ID: 'c', Name: 'wiki', URL: 'https://wiki.example.org', Online: true },
      { Timestamp: 2, ID: 'c', Name: 'wiki', URL: 'https://wiki.example.org', Online: false },
    ],
  } as unknown,
  stats: { TotalRequest: 1234, ValidRequest: 1200, ErrorRequest: 34 } as unknown,
});

export async function startFakeZoraxy(
  port = 0,
  username = 'admin',
  password = 'geheimes-passwort',
): Promise<FakeZoraxy> {
  const csrfToken = 'csrf-test-token';
  const fake = {
    url: '',
    username,
    password,
    ...seed(),
    failing: new Set<string>(),
    sessions: new Set<string>(),
    logins: 0,
    requests: [] as FakeZoraxy['requests'],
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    fake.requests.push({ method: req.method ?? '', path: url.pathname, search: url.search });
    const send = (
      status: number,
      body: unknown,
      headers: Record<string, string | string[]> = {},
    ) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const session = /(?:^|;\s*)zoraxy-session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const authed = !!session && fake.sessions.has(session);

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        // Wie Zoraxy: ein Fehler kommt als JSON mit Status 200.
        if (form.get('username') !== fake.username || form.get('password') !== fake.password)
          return send(200, { error: 'Invalid username or password' });
        fake.logins++;
        const id = `s${fake.logins}`;
        fake.sessions.add(id);
        send(200, 'ok', { 'set-cookie': `zoraxy-session=${id}; Path=/; HttpOnly` });
      });
      return;
    }
    if (url.pathname === '/api/info/x') return send(200, { Version: '3.3.4', Name: 'Zoraxy' });
    if (url.pathname === '/') {
      if (!authed) {
        res.writeHead(302, { location: '/login.html' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        `<html><head><meta name="zoraxy.csrf.Token" content="${csrfToken}"></head><body></body></html>`,
      );
    }
    // Alle übrigen Endpunkte verlangen Anmeldung und CSRF-Token.
    if (!authed || req.headers['x-csrf-token'] !== csrfToken) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      return res.end('401 - Unauthorized');
    }
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    if (fake.failing.has(url.pathname)) return send(500, { error: 'boom' });
    if (url.pathname === '/api/proxy/list')
      return url.searchParams.get('type') === 'host'
        ? send(200, fake.hosts)
        : send(200, { error: 'Invalid type given' });
    if (url.pathname === '/api/cert/list') return send(200, fake.certificates);
    if (url.pathname === '/api/utm/list') return send(200, fake.uptime);
    if (url.pathname === '/api/stats/summary') return send(200, fake.stats);
    return send(404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(fake, {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as FakeZoraxy;
}

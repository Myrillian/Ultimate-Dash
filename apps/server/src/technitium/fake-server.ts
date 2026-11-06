import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Simulierter Technitium DNS Server für Tests und lokale Entwicklung.
 * Bildet nur die Endpunkte nach, die Ultimate Dash nutzt, im Antwortformat der echten API.
 */
export interface FakeTechnitium {
  url: string;
  token: string;
  state: {
    enableBlocking: boolean;
    temporaryDisableBlockingTill: string | null;
    listUpdates: number;
  };
  requests: { path: string; params: Record<string, string>; authorization?: string }[];
  /** Erlaubte Pfade für das Token; null = alles erlaubt */
  allowedPaths: Set<string> | null;
  close(): Promise<void>;
}

function minuteLabels(count: number): string[] {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  return Array.from({ length: count }, (_, i) =>
    new Date(now - (count - 1 - i) * 60_000).toISOString().replace('Z', '0000Z'),
  );
}

function stats() {
  const labels = minuteLabels(60);
  const total = labels.map((_, i) => 40 + Math.round(25 * Math.sin(i / 6)) + (i % 7) * 3);
  const blocked = total.map((value, i) => Math.round(value * (0.08 + (i % 5) * 0.02)));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const totalQueries = sum(total);
  const totalBlocked = sum(blocked);
  const totalCached = Math.round(totalQueries * 0.46);
  const totalAuthoritative = Math.round(totalQueries * 0.07);
  const totalDropped = 3;
  return {
    stats: {
      totalQueries,
      totalNoError: totalQueries - 120,
      totalServerFailure: 4,
      totalNxDomain: 112,
      totalRefused: 4,
      totalAuthoritative,
      totalRecursive: totalQueries - totalCached - totalAuthoritative - totalBlocked - totalDropped,
      totalCached,
      totalBlocked,
      totalDropped,
      totalClients: 14,
      zones: 6,
      cachedEntries: 5321,
      allowedZones: 2,
      blockedZones: 3,
      allowListZones: 0,
      blockListZones: 287_455,
    },
    mainChartData: {
      labelFormat: 'HH:mm',
      labels,
      datasets: [
        { label: 'Total', data: total },
        { label: 'No Error', data: total },
        { label: 'Blocked', data: blocked },
        { label: 'Clients', data: total.map(() => 9) },
      ],
    },
    queryTypeChartData: {
      labels: ['A', 'AAAA', 'HTTPS', 'PTR', 'SRV', 'TXT'],
      datasets: [{ data: [1520, 830, 410, 96, 12, 0] }],
    },
    topClients: [
      { name: '10.10.0.21', domain: 'desktop.home.lan', hits: 812, rateLimited: false },
      { name: '10.10.0.35', domain: 'tv.home.lan', hits: 655, rateLimited: false },
      { name: '10.10.0.40', hits: 233, rateLimited: false },
    ],
    topDomains: [
      { name: 'connectivitycheck.gstatic.com', hits: 402 },
      { name: 'api.github.com', hits: 288 },
      { name: 'time.cloudflare.com', hits: 120 },
    ],
    topBlockedDomains: [
      { name: 'telemetry.example.net', hits: 140 },
      { name: 'ads.example.com', hits: 77 },
    ],
  };
}

export async function startFakeTechnitium(port = 0, token = 'test-token'): Promise<FakeTechnitium> {
  const fake: Omit<FakeTechnitium, 'url' | 'close'> = {
    token,
    state: { enableBlocking: true, temporaryDisableBlockingTill: null, listUpdates: 0 },
    requests: [],
    allowedPaths: null,
  };
  let timer: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const params = Object.fromEntries(
        new URLSearchParams(req.method === 'POST' ? body : url.search),
      );
      const path = url.pathname.replace(/^\/api\//, '');
      fake.requests.push({ path, params, authorization: req.headers.authorization });
      const send = (payload: object) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      };
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? params.token;
      if (bearer !== fake.token) return send({ status: 'invalid-token' });
      if (fake.allowedPaths && !fake.allowedPaths.has(path))
        return send({ status: 'error', errorMessage: 'Access was denied.' });

      const s = fake.state;
      if (
        s.temporaryDisableBlockingTill &&
        Date.parse(s.temporaryDisableBlockingTill) <= Date.now()
      ) {
        s.enableBlocking = true;
        s.temporaryDisableBlockingTill = null;
      }
      switch (path) {
        case 'settings/get':
          return send({
            status: 'ok',
            response: {
              version: '13.6',
              dnsServerDomain: 'dns.home.lan',
              enableBlocking: s.enableBlocking,
              blockListUrls: ['https://big.oisd.nl/', 'https://example.org/hosts'],
              blockListNextUpdatedOn: new Date(Date.now() + 6 * 3600_000).toISOString(),
              ...(s.temporaryDisableBlockingTill
                ? { temporaryDisableBlockingTill: s.temporaryDisableBlockingTill }
                : {}),
            },
          });
        case 'dashboard/stats/get':
          return send({ status: 'ok', response: stats() });
        case 'settings/temporaryDisableBlocking': {
          const minutes = Number(params.minutes);
          s.enableBlocking = false;
          s.temporaryDisableBlockingTill = new Date(Date.now() + minutes * 60_000).toISOString();
          clearTimeout(timer);
          return send({
            status: 'ok',
            response: { temporaryDisableBlockingTill: s.temporaryDisableBlockingTill },
          });
        }
        case 'settings/set':
          if (params.enableBlocking !== undefined) {
            s.enableBlocking = params.enableBlocking === 'true';
            s.temporaryDisableBlockingTill = null;
          }
          return send({ status: 'ok', response: {} });
        case 'settings/forceUpdateBlockLists':
          s.listUpdates++;
          return send({ status: 'ok' });
        default:
          return send({ status: 'error', errorMessage: `Unbekannter Pfad ${path}` });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

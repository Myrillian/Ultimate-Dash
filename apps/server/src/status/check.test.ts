import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkUrl, isReachable } from './check.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/no-head' && req.method === 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (req.url === '/head-404' && req.method === 'HEAD') {
      res.writeHead(404).end();
      return;
    }
    if (req.url === '/head-reset' && req.method === 'HEAD') {
      req.socket.destroy();
      return;
    }
    if (req.url === '/error') {
      res.writeHead(500).end();
      return;
    }
    if (req.url === '/slow') {
      setTimeout(() => res.writeHead(200).end(), 500);
      return;
    }
    res.writeHead(req.url === '/login' ? 401 : 200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('isReachable', () => {
  it('wertet 2xx, 3xx, 401 und 403 als erreichbar', () => {
    expect([200, 204, 301, 401, 403].every(isReachable)).toBe(true);
    expect([404, 500, 502].some(isReachable)).toBe(false);
  });
});

describe('checkUrl', () => {
  it('meldet erreichbare Dienste mit Antwortzeit', async () => {
    const status = await checkUrl(1, `${base}/`, { timeoutMs: 1000 });
    expect(status).toMatchObject({ serviceId: 1, state: 'up', httpStatus: 200, error: null });
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fällt auf GET zurück, wenn HEAD nicht erlaubt ist', async () => {
    const status = await checkUrl(1, `${base}/no-head`, { timeoutMs: 1000 });
    expect(status.state).toBe('up');
  });

  it('wertet Login-Seiten als erreichbar', async () => {
    expect((await checkUrl(1, `${base}/login`, { timeoutMs: 1000 })).state).toBe('up');
  });

  it('wiederholt mit GET, wenn HEAD mit 404 abgelehnt wird', async () => {
    const status = await checkUrl(1, `${base}/head-404`, { timeoutMs: 1000 });
    expect(status).toMatchObject({ state: 'up', httpStatus: 200 });
  });

  it('wiederholt mit GET, wenn die Verbindung bei HEAD abbricht', async () => {
    const status = await checkUrl(1, `${base}/head-reset`, { timeoutMs: 1000 });
    expect(status).toMatchObject({ state: 'up', httpStatus: 200 });
  });

  it('meldet Serverfehler als down', async () => {
    const status = await checkUrl(1, `${base}/error`, { timeoutMs: 1000 });
    expect(status).toMatchObject({ state: 'down', httpStatus: 500, error: 'HTTP 500' });
  });

  it('meldet Zeitüberschreitungen', async () => {
    const status = await checkUrl(1, `${base}/slow`, { timeoutMs: 100 });
    expect(status).toMatchObject({ state: 'down', error: 'Zeitüberschreitung' });
  });

  it('meldet abgelehnte Verbindungen', async () => {
    // Freien Port ermitteln und wieder schließen, damit garantiert niemand lauscht.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    const status = await checkUrl(1, `http://127.0.0.1:${port}/`, { timeoutMs: 1000 });
    expect(status).toMatchObject({ state: 'down', error: 'Verbindung abgelehnt' });
  });
});

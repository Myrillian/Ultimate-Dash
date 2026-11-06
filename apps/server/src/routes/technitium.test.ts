import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { AuditEntry, DnsSummary, TechnitiumSettings } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { startFakeTechnitium, type FakeTechnitium } from '../technitium/fake-server.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  webRoot: null,
  statusIntervalSeconds: 60,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
  technitium: null,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let fake: FakeTechnitium;
let cookie = '';

beforeEach(async () => {
  fake = await startFakeTechnitium();
  ctx = await buildApp(config, { logger: false, startMonitor: false });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: 'ein-langes-passwort' },
  });
  cookie = String(res.headers['set-cookie']).split(';')[0]!;
});
afterEach(async () => {
  await ctx.app.close();
  await fake.close();
});

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  as = cookie,
) => ctx.app.inject({ method, url, payload, headers: { cookie: as } });

const connect = () => call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });

describe('Technitium-Verbindung', () => {
  it('meldet ohne Verbindung „nicht verbunden“', async () => {
    const res = await call('GET', '/api/technitium/summary');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'not-configured' });
    expect((await call('GET', '/api/technitium/settings')).json()).toMatchObject({
      url: null,
      hasToken: false,
    });
  });

  it('speichert nur funktionierende Zugangsdaten und gibt das Token nie heraus', async () => {
    const wrong = await call('PUT', '/api/technitium/settings', { url: fake.url, token: 'falsch' });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json().error).toMatch(/Token ist ungültig/);

    const ok = await connect();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ version: '13.6', serverDomain: 'dns.home.lan' });
    expect(fake.requests.at(-1)!.authorization).toBe(`Bearer ${fake.token}`);

    const settings = await call('GET', '/api/technitium/settings');
    expect(settings.json<TechnitiumSettings>()).toEqual({
      url: fake.url,
      hasToken: true,
      tlsInsecure: false,
      source: 'settings',
    });
    expect(settings.body).not.toContain(fake.token);

    // Leeres Token beim erneuten Speichern behält das bisherige.
    const again = await call('PUT', '/api/technitium/settings', { url: `${fake.url}/`, token: '' });
    expect(again.statusCode).toBe(200);
  });

  it('übersetzt Netzwerkfehler in verständliche Meldungen', async () => {
    const closed = await startFakeTechnitium();
    await closed.close();
    const res = await call('POST', '/api/technitium/test', { url: closed.url, token: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/lehnt die Verbindung ab/);
  });

  it('liefert eine aufbereitete Zusammenfassung und puffert sie kurz', async () => {
    await connect();
    const res = await call('GET', '/api/technitium/summary?range=hour');
    expect(res.statusCode).toBe(200);
    const summary = res.json<DnsSummary>();
    expect(summary.series.labels).toHaveLength(60);
    expect(summary.series.queries).toHaveLength(60);
    expect(summary.totals.queries).toBeGreaterThan(summary.totals.blocked);
    expect(summary.queryTypes.map((q) => q.name)).toEqual(['A', 'AAAA', 'HTTPS', 'PTR', 'SRV']);
    expect(summary.topClients[0]).toEqual({
      name: '10.10.0.21',
      domain: 'desktop.home.lan',
      hits: 812,
    });
    expect(summary.topClients[2]!.domain).toBeNull();
    expect(summary.blocking).toMatchObject({ enabled: true, pausedUntil: null, listCount: 2 });
    expect(summary.blocking.blockedDomains).toBe(287_458);

    const before = fake.requests.length;
    await call('GET', '/api/technitium/summary?range=hour');
    expect(fake.requests.length).toBe(before);
  });

  it('steuert das Blocking und protokolliert jede Änderung', async () => {
    await connect();
    expect(
      (await call('POST', '/api/technitium/blocking', { action: 'pause', minutes: 15 })).statusCode,
    ).toBe(204);
    let blocking = (await call('GET', '/api/technitium/summary')).json<DnsSummary>().blocking;
    expect(blocking.enabled).toBe(false);
    const remaining = Date.parse(blocking.pausedUntil!) - Date.now();
    expect(remaining).toBeGreaterThan(14 * 60_000);
    expect(remaining).toBeLessThanOrEqual(15 * 60_000);

    await call('POST', '/api/technitium/blocking', { action: 'enable' });
    blocking = (await call('GET', '/api/technitium/summary')).json<DnsSummary>().blocking;
    expect(blocking).toMatchObject({ enabled: true, pausedUntil: null });

    await call('POST', '/api/technitium/blocking', { action: 'update-lists' });
    expect(fake.state.listUpdates).toBe(1);

    fake.allowedPaths = new Set(['settings/get', 'dashboard/stats/get']);
    const denied = await call('POST', '/api/technitium/blocking', { action: 'disable' });
    expect(denied.statusCode).toBe(502);
    expect(denied.json()).toMatchObject({ code: 'permission' });

    const log = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(log.map((e) => [e.action, e.ok])).toEqual([
      ['technitium.blocking.disable', false],
      ['technitium.blocking.update-lists', true],
      ['technitium.blocking.enable', true],
      ['technitium.blocking.pause', true],
      ['technitium.connect', true],
    ]);
    expect(log[0]).toMatchObject({ username: 'admin' });
  });

  it('erlaubt Nur-lesen-Benutzern nur das Ansehen der Statistik', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-pw' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-pw' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/technitium/summary', undefined, viewer)).statusCode).toBe(200);
    expect((await call('GET', '/api/technitium/settings', undefined, viewer)).statusCode).toBe(403);
    expect((await call('GET', '/api/audit', undefined, viewer)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/technitium/blocking', { action: 'disable' }, viewer)).statusCode,
    ).toBe(403);
  });
});

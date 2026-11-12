import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type {
  AuditEntry,
  ZoraxySettings,
  ZoraxySummary,
  ZoraxyTestResult,
} from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { startFakeZoraxy, type FakeZoraxy } from '../zoraxy/fake-server.js';
import { isAllowedPath } from '../zoraxy/client.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  webRoot: null,
  statusIntervalSeconds: 60,
  feedIntervalMinutes: 30,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
  technitium: null,
  proxmox: null,
  zoraxy: null,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let fake: FakeZoraxy;
let cookie = '';

beforeEach(async () => {
  fake = await startFakeZoraxy();
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

const connect = () =>
  call('PUT', '/api/zoraxy/settings', {
    url: fake.url,
    username: fake.username,
    password: fake.password,
  });

describe('Zoraxy-Verbindung', () => {
  it('meldet ohne Verbindung „nicht verbunden“', async () => {
    const res = await call('GET', '/api/zoraxy/summary');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'not-configured' });
  });

  it('weist ein falsches Passwort ab und speichert nichts', async () => {
    const wrong = await call('PUT', '/api/zoraxy/settings', {
      url: fake.url,
      username: fake.username,
      password: 'falsch',
    });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json()).toMatchObject({ code: 'auth' });
    expect((await call('GET', '/api/zoraxy/settings')).json<ZoraxySettings>().url).toBeNull();
  });

  it('speichert funktionierende Zugangsdaten und gibt das Passwort nie heraus', async () => {
    const res = await connect();
    expect(res.statusCode).toBe(200);
    expect(res.json<ZoraxyTestResult>()).toMatchObject({
      version: '3.3.4',
      hosts: 4,
      enabledHosts: 3,
      certificates: 2,
      warnings: [],
    });
    const settings = await call('GET', '/api/zoraxy/settings');
    expect(settings.json()).toEqual({
      url: fake.url,
      username: 'admin',
      hasPassword: true,
      tlsInsecure: false,
      source: 'settings',
    });
    expect(settings.body).not.toContain(fake.password);
    expect((await call('GET', '/api/zoraxy/summary')).body).not.toContain(fake.password);
  });

  it('behält das Passwort, wenn das Formular es leer lässt', async () => {
    await connect();
    const res = await call('PUT', '/api/zoraxy/settings', { url: fake.url, username: 'admin' });
    expect(res.statusCode).toBe(200);
    // Anderer Benutzer: das gespeicherte Passwort gilt nicht mehr.
    const other = await call('POST', '/api/zoraxy/test', { url: fake.url, username: 'anderer' });
    expect(other.statusCode).toBe(409);
  });

  it('liefert Hosts, Status, Zertifikate und Anfragen', async () => {
    await connect();
    const res = await call('GET', '/api/zoraxy/summary');
    expect(res.statusCode).toBe(200);
    const summary = res.json<ZoraxySummary>();
    expect(summary.version).toBe('3.3.4');
    expect(summary.counts).toEqual({ hosts: 4, enabled: 3, online: 2, offline: 1 });
    expect(summary.hosts.map((h) => h.domain)).toEqual([
      'ha.example.org',
      'nextcloud.example.org',
      'wiki.example.org',
      'alt.example.org',
    ]);
    const ha = summary.hosts[0]!;
    expect(ha).toMatchObject({ online: true, aliases: ['home.example.org'], enabled: true });
    expect(ha.certDays).toBeGreaterThanOrEqual(29);
    expect(summary.hosts[2]).toMatchObject({ online: false });
    expect(summary.hosts[2]!.certDays).toBeLessThanOrEqual(5);
    expect(summary.hosts[3]).toMatchObject({ enabled: false, online: null });
    expect(summary.nextExpiryDays).toBeLessThanOrEqual(5);
    expect(summary.requests).toEqual({ total: 1234, errors: 34 });
    expect(summary.warnings).toEqual([]);
    // Basic-Auth-Daten der Regeln werden nicht weitergegeben.
    expect(res.body).not.toContain('Username');
  });

  it('meldet sich bei abgelaufener Sitzung selbst neu an', async () => {
    await connect();
    await call('GET', '/api/zoraxy/summary');
    const logins = fake.logins;
    fake.sessions.clear();
    // Zwischenspeicher umgehen
    await new Promise((resolve) => setTimeout(resolve, 5));
    (ctx.zoraxy as unknown as { cache: null }).cache = null;
    const res = await call('GET', '/api/zoraxy/summary');
    expect(res.statusCode).toBe(200);
    expect(fake.logins).toBe(logins + 1);
  });

  it('zeigt den Rest, wenn ein optionaler Teil ausfällt', async () => {
    fake.failing.add('/api/cert/list');
    fake.failing.add('/api/stats/summary');
    await connect();
    const summary = (await call('GET', '/api/zoraxy/summary')).json<ZoraxySummary>();
    expect(summary.hosts).toHaveLength(4);
    expect(summary.certificates).toEqual([]);
    expect(summary.requests).toBeNull();
    expect(summary.warnings).toEqual([
      'Zertifikate konnten nicht gelesen werden',
      'Anfrage-Zahlen konnten nicht gelesen werden',
    ]);
  });

  it('schlägt fehl, wenn die Hostliste nicht lesbar ist, und versucht es erneut', async () => {
    await connect();
    fake.failing.add('/api/proxy/list');
    (ctx.zoraxy as unknown as { cache: null }).cache = null;
    expect((await call('GET', '/api/zoraxy/summary')).statusCode).toBe(502);
    fake.failing.clear();
    expect((await call('GET', '/api/zoraxy/summary')).statusCode).toBe(200);
  });

  it('fragt Zoraxy ausschließlich lesend und nur über erlaubte Pfade', async () => {
    await connect();
    await call('GET', '/api/zoraxy/summary');
    const writes = fake.requests.filter((r) => r.method !== 'GET');
    // Die einzige Ausnahme ist die Anmeldung (Test und laufende Sitzung melden sich getrennt an).
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((r) => r.method === 'POST' && r.path === '/api/auth/login')).toBe(true);
    expect(
      fake.requests
        .filter((r) => r.method === 'GET' && r.path !== '/')
        .every((r) => isAllowedPath(r.path)),
    ).toBe(true);
    expect(isAllowedPath('/api/proxy/del')).toBe(false);
    expect(isAllowedPath('/api/conf/export')).toBe(false);
    expect(isAllowedPath('/api/proxy/list/../del')).toBe(false);
  });

  it('ist nur für Admins sichtbar', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-passwort' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-passwort' },
    });
    const guest = String(login.headers['set-cookie']).split(';')[0]!;
    for (const [method, url] of [
      ['GET', '/api/zoraxy/summary'],
      ['GET', '/api/zoraxy/settings'],
      ['DELETE', '/api/zoraxy/settings'],
    ] as const) {
      expect((await call(method, url, undefined, guest)).statusCode).toBe(403);
    }
  });

  it('trennt die Verbindung und protokolliert Verbinden und Trennen', async () => {
    await connect();
    expect((await call('DELETE', '/api/zoraxy/settings')).statusCode).toBe(204);
    expect((await call('GET', '/api/zoraxy/summary')).statusCode).toBe(409);
    const audit = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(['zoraxy.connect', 'zoraxy.disconnect']),
    );
  });
});

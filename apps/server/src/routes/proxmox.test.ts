import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { AuditEntry, ProxmoxSettings, ProxmoxSummary } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { startFakeProxmox, type FakeProxmox } from '../proxmox/fake-server.js';

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
};

const GiB = 1024 ** 3;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let fake: FakeProxmox;
let cookie = '';

beforeEach(async () => {
  fake = await startFakeProxmox();
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
  call('PUT', '/api/proxmox/settings', {
    url: fake.url,
    tokenId: fake.tokenId,
    secret: fake.secret,
  });

describe('Proxmox-Verbindung', () => {
  it('meldet ohne Verbindung „nicht verbunden“', async () => {
    const res = await call('GET', '/api/proxmox/summary');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'not-configured' });
  });

  it('prüft das Format der Token-ID', async () => {
    const res = await call('POST', '/api/proxmox/test', {
      url: fake.url,
      tokenId: 'dashboard@pve',
      secret: 'x',
    });
    expect(res.statusCode).toBe(400);
  });

  it('speichert nur funktionierende Zugangsdaten und gibt das Secret nie heraus', async () => {
    const wrong = await call('PUT', '/api/proxmox/settings', {
      url: fake.url,
      tokenId: fake.tokenId,
      secret: 'falsch',
    });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json().error).toMatch(/Secret sind falsch/);

    const ok = await connect();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      version: '9.0.3',
      nodes: ['pve'],
      vms: 3,
      containers: 3,
      extraPrivileges: [],
    });
    expect(fake.requests.at(-1)!.authorization).toBe(`PVEAPIToken=${fake.tokenId}=${fake.secret}`);

    const settings = await call('GET', '/api/proxmox/settings');
    expect(settings.json<ProxmoxSettings>()).toEqual({
      url: fake.url,
      tokenId: fake.tokenId,
      hasSecret: true,
      tlsInsecure: false,
      source: 'settings',
    });
    expect(settings.body).not.toContain(fake.secret);

    // Leeres Secret behält das gespeicherte.
    const again = await call('POST', '/api/proxmox/test', { url: fake.url, tokenId: fake.tokenId });
    expect(again.statusCode).toBe(200);
    // … aber nicht für eine andere Token-ID.
    const other = await call('POST', '/api/proxmox/test', {
      url: fake.url,
      tokenId: 'jemand@pve!anderes',
    });
    expect(other.statusCode).toBe(409);

    const audit = await call('GET', '/api/audit');
    expect(audit.json<AuditEntry[]>()[0]).toMatchObject({
      action: 'proxmox.connect',
    });
  });

  it('warnt, wenn das Token mehr als lesen darf', async () => {
    fake.permissions = { '/': { 'Sys.Audit': 1, 'VM.PowerMgmt': 1 }, '/vms': { 'VM.Audit': 1 } };
    const res = await connect();
    expect(res.json().extraPrivileges).toEqual(['VM.PowerMgmt']);
  });

  it('meldet fehlende Rechte, wenn das Token keinen Knoten sieht', async () => {
    fake.resources = [];
    const res = await connect();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: 'permission' });
  });

  it('fragt Proxmox nur lesend ab', async () => {
    await connect();
    await call('GET', '/api/proxmox/summary');
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('ist nur für Admins', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-passwort' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-passwort' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/proxmox/summary', undefined, viewer)).statusCode).toBe(403);
    expect((await call('GET', '/api/proxmox/settings', undefined, viewer)).statusCode).toBe(403);
  });
});

describe('Proxmox-Kennzahlen', () => {
  it('fasst Host, Gäste und Datastores zusammen', async () => {
    await connect();
    const res = await call('GET', '/api/proxmox/summary');
    expect(res.statusCode).toBe(200);
    const s = res.json<ProxmoxSummary>();
    expect(s.nodes).toEqual([{ name: 'pve', online: true, uptime: 864_000 }]);
    expect(s.cpu).toEqual({ usage: 0.23, cores: 16 });
    expect(s.memory).toEqual({ used: 41 * GiB, total: 128 * GiB });
    // Vorlagen zählen nicht mit, gestoppte Gäste kommen mit Namen.
    expect(s.vms).toEqual({
      total: 3,
      running: 2,
      notRunning: [{ id: 105, name: 'windows-test', status: 'stopped' }],
    });
    expect(s.containers).toMatchObject({
      total: 3,
      running: 2,
      notRunning: [{ id: 202, name: 'nextcloud-test', status: 'stopped' }],
    });
    expect(s.storages.map((x) => x.name)).toEqual(['local', 'local-lvm', 'nas']);
    expect(s.storages[2]).toMatchObject({ shared: true, used: 2000 * GiB, total: 8000 * GiB });
    // Netzwerk: letzter vollständiger Wert aus dem Verlauf.
    expect(s.network!.in).toBeGreaterThan(0);
    expect(s.history.cpu.length).toBe(69);
    // Disk-Durchsatz gibt es erst ab dem zweiten Abruf.
    expect(s.diskIo).toBeNull();
  });

  it('teilt sich Abrufe für einige Sekunden', async () => {
    await connect();
    const before = fake.requests.length;
    await call('GET', '/api/proxmox/summary');
    await call('GET', '/api/proxmox/summary');
    // ein Abruf = cluster/resources + rrddata
    expect(fake.requests.length - before).toBe(2);
  });
});

describe('Proxmox-Kennzahlen ohne Rechte', () => {
  it('meldet fehlende Rechte statt leerer Werte', async () => {
    await connect();
    fake.resources = [];
    const res = await call('GET', '/api/proxmox/summary');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: 'permission' });
  });

  it('erkennt einen Knoten ohne Werte (Token ohne Sys.Audit)', async () => {
    // So antwortet Proxmox, wenn die Rolle nur dem Benutzer, nicht dem Token gegeben wurde.
    fake.resources = [{ id: 'node/pve', type: 'node', node: 'pve', status: 'online' }];
    const test = await call('POST', '/api/proxmox/test', {
      url: fake.url,
      tokenId: fake.tokenId,
      secret: fake.secret,
    });
    expect(test.statusCode).toBe(502);
    expect(test.json().error).toMatch(/keine Werte.*PVEAuditor/);
  });
});

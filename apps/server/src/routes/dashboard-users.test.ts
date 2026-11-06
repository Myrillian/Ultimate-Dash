import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { CopySummary, DashboardData, DashboardSource } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { createRepository } from '../db/repository.js';
import { groups, settings, users } from '../db/schema.js';
import { EventHub } from '../events.js';
import { StatusMonitor } from '../status/monitor.js';
import type { Service } from '@ultimate-dash/shared';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder,
  webRoot: null,
  statusIntervalSeconds: 60,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
};
const PASSWORD = 'ein-langes-passwort';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let admin = '';
let viewer = '';
let viewerId = 0;
let adminId = 0;

const call = (
  as: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) => ctx.app.inject({ method, url, payload, headers: { cookie: as } });

beforeEach(async () => {
  ctx = await buildApp(config, { logger: false, startMonitor: false });
  const setup = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: PASSWORD },
  });
  admin = String(setup.headers['set-cookie']).split(';')[0]!;
  adminId = setup.json().id;
  const created = await call(admin, 'POST', '/api/users', {
    username: 'gast',
    password: PASSWORD,
  });
  viewerId = created.json().id;
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'gast', password: PASSWORD },
  });
  viewer = String(login.headers['set-cookie']).split(';')[0]!;
});
afterEach(async () => {
  await ctx.app.close();
});

async function addGroup(as: string, name: string) {
  return (await call(as, 'POST', '/api/groups', { name })).json<{ id: number }>();
}
async function addService(as: string, groupId: number, name: string, url?: string) {
  const res = await call(as, 'POST', '/api/services', {
    groupId,
    name,
    url: url ?? `http://${name.toLowerCase()}.lan`,
    statusCheck: false,
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>();
}
const board = async (as: string) => (await call(as, 'GET', '/api/dashboard')).json<DashboardData>();

describe('Dashboard pro Benutzer', () => {
  it('startet für neue Benutzer leer und trennt die Dashboards', async () => {
    const g = await addGroup(admin, 'Admin-Gruppe');
    await addService(admin, g.id, 'Wiki');
    expect((await board(viewer)).groups).toHaveLength(0);
    const own = await addGroup(viewer, 'Meins');
    await addService(viewer, own.id, 'Notizen');
    expect((await board(admin)).groups.map((x) => x.name)).toEqual(['Admin-Gruppe']);
    expect((await board(viewer)).groups.map((x) => x.name)).toEqual(['Meins']);
  });

  it('behandelt fremde Gruppen und Services als nicht gefunden', async () => {
    const g = await addGroup(admin, 'Admin-Gruppe');
    const s = await addService(admin, g.id, 'Wiki');
    expect((await call(viewer, 'PUT', `/api/groups/${g.id}`, { name: 'X' })).statusCode).toBe(404);
    expect((await call(viewer, 'DELETE', `/api/groups/${g.id}`)).statusCode).toBe(404);
    expect((await call(viewer, 'DELETE', `/api/services/${s.id}`)).statusCode).toBe(404);
    const own = await addGroup(viewer, 'Meins');
    const created = await call(viewer, 'POST', '/api/services', {
      groupId: g.id,
      name: 'Eindringling',
      url: 'http://x.lan',
    });
    expect(created.statusCode).toBe(404);
    const arrange = await call(viewer, 'PUT', '/api/services/arrange', {
      groupId: own.id,
      ids: [s.id],
    });
    expect(arrange.statusCode).toBe(404);
    expect((await board(admin)).groups[0]!.services).toHaveLength(1);
  });

  it('sortiert Gruppen nur innerhalb des eigenen Dashboards', async () => {
    const a1 = await addGroup(admin, 'A1');
    const a2 = await addGroup(admin, 'A2');
    const v1 = await addGroup(viewer, 'V1');
    const ok = await call(admin, 'PUT', '/api/groups/order', { ids: [a2.id, a1.id] });
    expect(ok.statusCode).toBe(204);
    const bad = await call(admin, 'PUT', '/api/groups/order', { ids: [a2.id, a1.id, v1.id] });
    expect(bad.statusCode).toBe(400);
  });

  it('führt Titel und Konfiguration pro Benutzer', async () => {
    const yaml = 'version: 1\ntitle: Gast-Lab\ngroups:\n  - name: G\n    services: []\n';
    const res = await call(viewer, 'POST', '/api/config/import', { yaml, mode: 'replace' });
    expect(res.statusCode).toBe(200);
    expect((await board(viewer)).title).toBe('Gast-Lab');
    expect((await board(admin)).title).toBe('Ultimate Dash');
    // „replace“ löscht nur das eigene Dashboard.
    const g = await addGroup(admin, 'Bleibt');
    await call(viewer, 'POST', '/api/config/import', { yaml, mode: 'replace' });
    expect((await board(admin)).groups.map((x) => x.id)).toEqual([g.id]);
  });

  it('filtert den Status auf eigene Services', async () => {
    const g = await addGroup(admin, 'A');
    const s = await addService(admin, g.id, 'Wiki');
    ctx.monitor['statuses'].set(s.id, {
      serviceId: s.id,
      state: 'up',
      httpStatus: 200,
      latencyMs: 1,
      error: null,
      checkedAt: new Date().toISOString(),
    });
    expect((await call(admin, 'GET', '/api/status')).json()).toHaveLength(1);
    expect((await call(viewer, 'GET', '/api/status')).json()).toHaveLength(0);
  });

  it('benachrichtigt bei Änderungen nur den Besitzer', async () => {
    const seen: (number | undefined)[] = [];
    const off = ctx.events.subscribe((event, owner) => {
      if (event.type === 'dashboard-changed') seen.push(owner);
    });
    await addGroup(viewer, 'V');
    off();
    expect(seen).toEqual([viewerId]);
  });

  it('lässt Nur-lesen-Benutzer das Dashboard, aber nicht das IPAM ändern', async () => {
    expect((await call(viewer, 'POST', '/api/groups', { name: 'ok' })).statusCode).toBe(201);
    expect((await call(viewer, 'DELETE', '/api/ipam/networks/1')).statusCode).toBe(403);
    expect((await call(viewer, 'PUT', '/api/ipam/scan', {})).statusCode).toBe(403);
  });
});

describe('Kopieren aus anderen Dashboards', () => {
  it('listet nur Dashboards anderer Benutzer mit Inhalt', async () => {
    expect((await call(viewer, 'GET', '/api/dashboards')).json()).toEqual([]);
    const g = await addGroup(admin, 'Medien');
    await addService(admin, g.id, 'Jellyfin');
    const sources = (await call(viewer, 'GET', '/api/dashboards')).json<DashboardSource[]>();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ userId: adminId, username: 'admin' });
    expect(sources[0]!.groups[0]!.services.map((s) => s.name)).toEqual(['Jellyfin']);
    expect((await call(admin, 'GET', '/api/dashboards')).json()).toEqual([]);
  });

  it('kopiert ausgewählte Services als unabhängige Kopie', async () => {
    const g = await addGroup(admin, 'Medien');
    const a = await addService(admin, g.id, 'Jellyfin');
    await addService(admin, g.id, 'Sonarr');
    const res = await call(viewer, 'POST', '/api/dashboard/copy', {
      sourceUserId: adminId,
      groups: [{ groupId: g.id, serviceIds: [a.id] }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<CopySummary>()).toEqual({
      groupsCreated: 1,
      groupsExtended: 0,
      servicesCreated: 1,
      servicesSkipped: 0,
    });
    const mine = await board(viewer);
    expect(mine.groups.map((x) => [x.name, x.services.map((s) => s.name)])).toEqual([
      ['Medien', ['Jellyfin']],
    ]);
    // Änderung am Original wirkt nicht auf die Kopie.
    await call(admin, 'PUT', `/api/services/${a.id}`, {
      groupId: g.id,
      name: 'Umbenannt',
      url: 'http://x.lan',
    });
    expect((await board(viewer)).groups[0]!.services[0]!.name).toBe('Jellyfin');
  });

  it('ergänzt gleichnamige Gruppen und überspringt gleichnamige Services', async () => {
    const g = await addGroup(admin, 'Medien');
    const a = await addService(admin, g.id, 'Jellyfin');
    const b = await addService(admin, g.id, 'Sonarr');
    const own = await addGroup(viewer, 'medien');
    await addService(viewer, own.id, 'jellyfin');
    const res = await call(viewer, 'POST', '/api/dashboard/copy', {
      sourceUserId: adminId,
      groups: [{ groupId: g.id, serviceIds: [a.id, b.id] }],
    });
    expect(res.json<CopySummary>()).toEqual({
      groupsCreated: 0,
      groupsExtended: 1,
      servicesCreated: 1,
      servicesSkipped: 1,
    });
    const mine = await board(viewer);
    expect(mine.groups).toHaveLength(1);
    expect(mine.groups[0]!.services.map((s) => s.name)).toEqual(['jellyfin', 'Sonarr']);
  });

  it('lehnt Fremdes, Falsches und das eigene Dashboard ab', async () => {
    const g = await addGroup(admin, 'Medien');
    const s = await addService(admin, g.id, 'Jellyfin');
    const own = await addGroup(viewer, 'Meins');
    // Gruppe gehört nicht zur angegebenen Quelle
    const wrongSource = await call(admin, 'POST', '/api/dashboard/copy', {
      sourceUserId: viewerId,
      groups: [{ groupId: g.id, serviceIds: [] }],
    });
    expect(wrongSource.statusCode).toBe(404);
    // Service gehört nicht zur Gruppe
    const wrongService = await call(viewer, 'POST', '/api/dashboard/copy', {
      sourceUserId: adminId,
      groups: [{ groupId: g.id, serviceIds: [s.id + 99] }],
    });
    expect(wrongService.statusCode).toBe(404);
    expect((await board(viewer)).groups.map((x) => x.id)).toEqual([own.id]);
    const self = await call(viewer, 'POST', '/api/dashboard/copy', {
      sourceUserId: viewerId,
      groups: [{ groupId: own.id, serviceIds: [] }],
    });
    expect(self.statusCode).toBe(400);
  });
});

describe('Altbestand', () => {
  it('übergibt Gruppen ohne Besitzer und den Titel an den ersten Admin', () => {
    const { db, close } = openDatabase(':memory:', migrationsFolder);
    const repo = createRepository(db);
    const first = db.insert(users).values({ username: 'a', role: 'admin' }).returning().get();
    const second = db.insert(users).values({ username: 'b', role: 'admin' }).returning().get();
    db.insert(groups).values({ name: 'Alt', userId: null }).run();
    db.insert(settings).values({ key: 'title', value: 'Altes Lab' }).run();
    expect(repo.getDashboard(second.id).groups).toHaveLength(0);
    const adopted = repo.getDashboard(first.id);
    expect(adopted.groups.map((g) => g.name)).toEqual(['Alt']);
    expect(adopted.title).toBe('Altes Lab');
    close();
  });
});

describe('Statusprüfung', () => {
  it('prüft ein gemeinsames Ziel nur einmal und meldet es allen Besitzern', async () => {
    const calls: string[] = [];
    const server = await import('node:http').then(
      ({ createServer }) =>
        new Promise<{ url: string; close: () => void }>((resolve) => {
          const s = createServer((req, res) => {
            calls.push(req.url ?? '');
            res.end('ok');
          }).listen(0, '127.0.0.1', () => {
            const { port } = s.address() as { port: number };
            resolve({ url: `http://127.0.0.1:${port}/x`, close: () => s.close() });
          });
        }),
    );
    const make = (id: number): Service => ({
      id,
      groupId: id,
      name: `S${id}`,
      url: server.url,
      description: null,
      icon: null,
      target: '_blank',
      statusCheck: true,
      statusUrl: null,
      tags: [],
      sortOrder: 0,
    });
    const monitor = new StatusMonitor({
      intervalMs: 60_000,
      timeoutMs: 1000,
      listServices: () => [make(1), make(2), make(3)],
      events: new EventHub(),
    });
    await monitor.runAll();
    server.close();
    expect(calls.length).toBeLessThanOrEqual(1);
    expect(monitor.snapshot().map((s) => [s.serviceId, s.state])).toEqual([
      [1, 'up'],
      [2, 'up'],
      [3, 'up'],
    ]);
  });
});

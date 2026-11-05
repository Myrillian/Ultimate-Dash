import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { DashboardData } from '@ultimate-dash/shared';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  webRoot: null,
  statusIntervalSeconds: 60,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';

beforeEach(async () => {
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
});

const json = <T>(res: { body: string }) => JSON.parse(res.body) as T;

async function createGroup(name: string) {
  const res = await ctx.app.inject({
    headers: { cookie },
    method: 'POST',
    url: '/api/groups',
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: number }>(res);
}

async function createService(groupId: number, name: string) {
  const res = await ctx.app.inject({
    headers: { cookie },
    method: 'POST',
    url: '/api/services',
    // statusCheck aus, damit im Test keine echten Anfragen rausgehen
    payload: { groupId, name, url: `http://${name.toLowerCase()}.lan`, statusCheck: false },
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: number }>(res);
}

const dashboard = async () =>
  json<DashboardData>(
    await ctx.app.inject({ headers: { cookie }, method: 'GET', url: '/api/dashboard' }),
  );

describe('API', () => {
  it('meldet sich gesund', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ status: 'ok' });
  });

  it('liefert ein leeres Dashboard mit Standardtitel', async () => {
    expect(await dashboard()).toEqual({ title: 'Ultimate Dash', groups: [] });
  });

  it('legt Gruppen und Services an und liefert sie sortiert', async () => {
    const infra = await createGroup('Infrastruktur');
    const media = await createGroup('Medien');
    await createService(infra.id, 'Proxmox');
    await createService(infra.id, 'Technitium');
    await createService(media.id, 'Jellyfin');

    const data = await dashboard();
    expect(data.groups.map((g) => g.name)).toEqual(['Infrastruktur', 'Medien']);
    expect(data.groups[0]!.services.map((s) => s.name)).toEqual(['Proxmox', 'Technitium']);
    expect(data.groups[1]!.services.map((s) => s.name)).toEqual(['Jellyfin']);
  });

  it('lehnt ungültige Eingaben mit 400 und Details ab', async () => {
    const group = await createGroup('Test');
    const res = await ctx.app.inject({
      headers: { cookie },
      method: 'POST',
      url: '/api/services',
      payload: { groupId: group.id, name: '', url: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    const body = json<{ issues: { path: string[] }[] }>(res);
    expect(body.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['name', 'url']));
  });

  it('gibt 404 für unbekannte Gruppen zurück', async () => {
    const res = await ctx.app.inject({
      headers: { cookie },
      method: 'POST',
      url: '/api/services',
      payload: { groupId: 999, name: 'X', url: 'http://x.lan' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('ordnet Gruppen neu und verlangt dabei alle IDs', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const incomplete = await ctx.app.inject({
      headers: { cookie },
      method: 'PUT',
      url: '/api/groups/order',
      payload: { ids: [b.id] },
    });
    expect(incomplete.statusCode).toBe(400);

    const ok = await ctx.app.inject({
      headers: { cookie },
      method: 'PUT',
      url: '/api/groups/order',
      payload: { ids: [b.id, a.id] },
    });
    expect(ok.statusCode).toBe(204);
    expect((await dashboard()).groups.map((g) => g.name)).toEqual(['B', 'A']);
  });

  it('verschiebt Services zwischen Gruppen', async () => {
    const a = await createGroup('A');
    const b = await createGroup('B');
    const s1 = await createService(a.id, 'Eins');
    const s2 = await createService(b.id, 'Zwei');

    const res = await ctx.app.inject({
      headers: { cookie },
      method: 'PUT',
      url: '/api/services/arrange',
      payload: { groupId: b.id, ids: [s1.id, s2.id] },
    });
    expect(res.statusCode).toBe(204);
    const data = await dashboard();
    expect(data.groups[0]!.services).toHaveLength(0);
    expect(data.groups[1]!.services.map((s) => s.name)).toEqual(['Eins', 'Zwei']);
  });

  it('löscht beim Entfernen einer Gruppe auch ihre Services', async () => {
    const group = await createGroup('Weg');
    await createService(group.id, 'Alt');
    const res = await ctx.app.inject({
      headers: { cookie },
      method: 'DELETE',
      url: `/api/groups/${group.id}`,
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.repo.listServices()).toHaveLength(0);
  });

  it('aktualisiert Services', async () => {
    const group = await createGroup('G');
    const service = await createService(group.id, 'Alt');
    const res = await ctx.app.inject({
      headers: { cookie },
      method: 'PUT',
      url: `/api/services/${service.id}`,
      payload: {
        groupId: group.id,
        name: 'Neu',
        url: 'https://neu.lan',
        description: 'Beschreibung',
        statusCheck: false,
        tags: ['dns'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ name: 'Neu', description: 'Beschreibung', tags: ['dns'] });
  });
});

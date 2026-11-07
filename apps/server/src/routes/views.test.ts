import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { SavedView } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { openDatabase } from '../db/client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder,
  webRoot: null,
  statusIntervalSeconds: 60,
  feedIntervalMinutes: 30,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
};
const PASSWORD = 'ein-langes-passwort';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let admin = '';
let viewer = '';

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
  await call(admin, 'POST', '/api/users', {
    username: 'gast',
    password: PASSWORD,
  });
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

const view = {
  scope: 'ipam',
  name: 'Offline',
  params: { status: 'offline', q: 'nas' },
  hidden: ['mac'],
};
const list = async (as: string, scope = 'ipam') =>
  (await call(as, 'GET', `/api/views?scope=${scope}`)).json<SavedView[]>();

describe('Gespeicherte Ansichten', () => {
  it('speichert pro Benutzer, auch ohne Admin-Rechte', async () => {
    const saved = await call(viewer, 'PUT', '/api/views', view);
    expect(saved.statusCode).toBe(200);
    expect(await list(viewer)).toMatchObject([
      { name: 'Offline', params: view.params, hidden: ['mac'] },
    ]);
    expect(await list(admin)).toEqual([]);
    expect(await list(viewer, 'dns')).toEqual([]);
  });

  it('überschreibt eine Ansicht mit gleichem Namen und verwirft leere Filter', async () => {
    await call(admin, 'PUT', '/api/views', view);
    await call(admin, 'PUT', '/api/views', { ...view, params: { q: 'x', type: '' }, hidden: [] });
    const all = await list(admin);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ params: { q: 'x' }, hidden: [] });
  });

  it('löscht nur eigene Ansichten', async () => {
    const mine = (await call(admin, 'PUT', '/api/views', view)).json<SavedView>();
    expect((await call(viewer, 'DELETE', `/api/views/${mine.id}`)).statusCode).toBe(404);
    expect((await call(admin, 'DELETE', `/api/views/${mine.id}`)).statusCode).toBe(204);
    expect(await list(admin)).toEqual([]);
  });

  it('lehnt ungültige Eingaben und Anonyme ab', async () => {
    expect((await call(admin, 'PUT', '/api/views', { ...view, name: ' ' })).statusCode).toBe(400);
    expect((await call(admin, 'PUT', '/api/views', { ...view, scope: 'dhcp' })).statusCode).toBe(
      400,
    );
    expect((await ctx.app.inject({ method: 'GET', url: '/api/views?scope=ipam' })).statusCode).toBe(
      401,
    );
  });
});

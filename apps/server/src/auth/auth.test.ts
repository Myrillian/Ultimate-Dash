import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { AuthStatus, User } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { hashPassword, verifyPassword } from './password.js';

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
};

const PASSWORD = 'ein-langes-passwort';

let ctx: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  ctx = await buildApp(config, { logger: false, startMonitor: false });
});
afterEach(async () => {
  await ctx.app.close();
});

type InjectOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  payload?: object;
  cookie?: string;
  headers?: Record<string, string>;
};
const call = (o: InjectOptions) =>
  ctx.app.inject({
    method: o.method,
    url: o.url,
    payload: o.payload,
    headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
  });
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie']).split(';')[0]!;

async function setupAdmin() {
  const res = await call({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'Admin', password: PASSWORD },
  });
  expect(res.statusCode).toBe(201);
  return cookieOf(res);
}

describe('Passwort-Hashing', () => {
  it('prüft richtige und falsche Passwörter', async () => {
    const hash = await hashPassword('geheim-und-lang');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('geheim-und-lang', hash)).toBe(true);
    expect(await verifyPassword('falsch', hash)).toBe(false);
    expect(await verifyPassword('x', 'kaputt')).toBe(false);
  });
});

describe('Ersteinrichtung', () => {
  it('meldet zuerst, dass eine Einrichtung nötig ist', async () => {
    const res = await call({ method: 'GET', url: '/api/auth/status' });
    expect(JSON.parse(res.body)).toEqual({
      setupRequired: true,
      user: null,
      oidc: null,
      passwordResetMail: false,
    });
  });

  it('legt den ersten Admin an, meldet ihn an und speichert den Namen klein', async () => {
    const cookie = await setupAdmin();
    const status = JSON.parse(
      (await call({ method: 'GET', url: '/api/auth/status', cookie })).body,
    ) as AuthStatus;
    expect(status.setupRequired).toBe(false);
    expect(status.user).toMatchObject({ username: 'admin', role: 'admin' });
  });

  it('lässt sich nur einmal ausführen', async () => {
    await setupAdmin();
    const res = await call({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'zweiter', password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
  });

  it('verlangt ein ausreichend langes Passwort', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: 'kurz' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('setzt ein HttpOnly-Cookie mit SameSite=Lax', async () => {
    const res = await call({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: PASSWORD },
    });
    const header = String(res.headers['set-cookie']);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });
});

describe('Login und Zugriffsschutz', () => {
  it('sperrt die API ohne Anmeldung', async () => {
    await setupAdmin();
    expect((await call({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
    expect((await call({ method: 'GET', url: '/api/events' })).statusCode).toBe(401);
    expect((await call({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('meldet mit richtigem Passwort an und lehnt falsche ab', async () => {
    await setupAdmin();
    const wrong = await call({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'falsch' },
    });
    expect(wrong.statusCode).toBe(401);
    const unknown = await call({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'niemand', password: 'x' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(JSON.parse(unknown.body).error).toBe(JSON.parse(wrong.body).error);

    const ok = await call({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ADMIN', password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (await call({ method: 'GET', url: '/api/dashboard', cookie: cookieOf(ok) })).statusCode,
    ).toBe(200);
  });

  it('begrenzt Fehlversuche', async () => {
    await setupAdmin();
    for (let i = 0; i < 10; i++) {
      await call({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'falsch' },
      });
    }
    const blocked = await call({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: PASSWORD },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('beendet die Session beim Abmelden', async () => {
    const cookie = await setupAdmin();
    expect((await call({ method: 'POST', url: '/api/auth/logout', cookie })).statusCode).toBe(204);
    expect((await call({ method: 'GET', url: '/api/dashboard', cookie })).statusCode).toBe(401);
  });

  it('lehnt schreibende Anfragen von fremder Herkunft ab', async () => {
    const cookie = await setupAdmin();
    const res = await call({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'X' },
      cookie,
      headers: { origin: 'https://boese.example', host: 'dash.home.lan' },
    });
    expect(res.statusCode).toBe(403);
    const same = await call({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'X' },
      cookie,
      headers: { origin: 'http://dash.home.lan', host: 'dash.home.lan' },
    });
    expect(same.statusCode).toBe(201);
  });
});

describe('Rollen und Benutzerverwaltung', () => {
  async function createViewer(adminCookie: string) {
    const res = await call({
      method: 'POST',
      url: '/api/users',
      cookie: adminCookie,
      payload: { username: 'gast', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    const user = JSON.parse(res.body) as User;
    const login = await call({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: PASSWORD },
    });
    return { user, cookie: cookieOf(login) };
  }

  it('erlaubt „Nur lesen“-Benutzern das eigene Dashboard, aber keine Verwaltung', async () => {
    const admin = await setupAdmin();
    const viewer = await createViewer(admin);
    expect(viewer.user.role).toBe('viewer');
    expect(
      (await call({ method: 'GET', url: '/api/dashboard', cookie: viewer.cookie })).statusCode,
    ).toBe(200);
    expect(
      (
        await call({
          method: 'POST',
          url: '/api/groups',
          cookie: viewer.cookie,
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call({
          method: 'POST',
          url: '/api/ipam/categories',
          cookie: viewer.cookie,
          payload: { name: 'X', color: 'blue' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call({ method: 'GET', url: '/api/users', cookie: viewer.cookie })).statusCode,
    ).toBe(403);
  });

  it('lässt Benutzer ihr eigenes Passwort ändern und meldet andere Sitzungen ab', async () => {
    const admin = await setupAdmin();
    const viewer = await createViewer(admin);
    const second = cookieOf(
      await call({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'gast', password: PASSWORD },
      }),
    );
    const wrong = await call({
      method: 'POST',
      url: '/api/auth/password',
      cookie: viewer.cookie,
      payload: { currentPassword: 'falsch', newPassword: 'neues-langes-passwort' },
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await call({
      method: 'POST',
      url: '/api/auth/password',
      cookie: viewer.cookie,
      payload: { currentPassword: PASSWORD, newPassword: 'neues-langes-passwort' },
    });
    expect(ok.statusCode).toBe(204);
    expect(
      (await call({ method: 'GET', url: '/api/dashboard', cookie: viewer.cookie })).statusCode,
    ).toBe(200);
    expect((await call({ method: 'GET', url: '/api/dashboard', cookie: second })).statusCode).toBe(
      401,
    );
  });

  it('schützt den letzten Admin', async () => {
    const admin = await setupAdmin();
    const me = JSON.parse(
      (await call({ method: 'GET', url: '/api/auth/status', cookie: admin })).body,
    ).user as User;
    expect(
      (await call({ method: 'DELETE', url: `/api/users/${me.id}`, cookie: admin })).statusCode,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'PUT',
          url: `/api/users/${me.id}`,
          cookie: admin,
          payload: { role: 'viewer' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('meldet Benutzer nach einer Rollenänderung ab und löscht sie', async () => {
    const admin = await setupAdmin();
    const viewer = await createViewer(admin);
    const promoted = await call({
      method: 'PUT',
      url: `/api/users/${viewer.user.id}`,
      cookie: admin,
      payload: { role: 'admin' },
    });
    expect(JSON.parse(promoted.body).role).toBe('admin');
    expect(
      (await call({ method: 'GET', url: '/api/dashboard', cookie: viewer.cookie })).statusCode,
    ).toBe(401);
    expect(
      (await call({ method: 'DELETE', url: `/api/users/${viewer.user.id}`, cookie: admin }))
        .statusCode,
    ).toBe(204);
    const list = JSON.parse(
      (await call({ method: 'GET', url: '/api/users', cookie: admin })).body,
    ) as User[];
    expect(list.map((u) => u.username)).toEqual(['admin']);
  });

  it('lehnt doppelte Benutzernamen ab', async () => {
    const admin = await setupAdmin();
    const res = await call({
      method: 'POST',
      url: '/api/users',
      cookie: admin,
      payload: { username: 'admin', password: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
  });
});

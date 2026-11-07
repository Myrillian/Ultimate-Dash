import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { RESET_PATH, type AuthStatus, type ResetLink, type User } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import { runCli } from '../cli.js';
import type { AppConfig } from '../config.js';
import type { MailConfig, Mailer } from './mailer.js';

const PASSWORD = 'ein-langes-passwort';
const NEW_PASSWORD = 'ganz-neues-passwort';
const mailConfig: MailConfig = {
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  user: null,
  password: null,
  from: 'dash@example.org',
  tlsInsecure: false,
  publicUrl: 'https://dash.example.org',
};
const baseConfig: AppConfig = {
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

let ctx: Awaited<ReturnType<typeof buildApp>>;
let sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  async send(message) {
    sent.push(message);
  },
};

async function start(withMail: boolean) {
  sent = [];
  ctx = await buildApp(
    { ...baseConfig, mail: withMail ? mailConfig : null },
    { logger: false, startMonitor: false, mailer },
  );
  const setup = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: PASSWORD },
  });
  const admin = String(setup.headers['set-cookie']).split(';')[0]!;
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie: admin },
    payload: { username: 'anna', password: PASSWORD, email: 'Anna@Example.org' },
  });
  expect(created.statusCode).toBe(201);
  return { admin, anna: created.json<User>() };
}
afterEach(async () => {
  await ctx?.app.close();
});

const post = (url: string, payload: object, cookie?: string) =>
  ctx.app.inject({ method: 'POST', url, payload, headers: cookie ? { cookie } : {} });
const login = (password: string) =>
  post('/api/auth/login', { username: 'anna', password }).then((r) => r.statusCode);
const tokenFrom = (text: string) => /#token=([\w-]+)/.exec(text)![1]!;

describe('Passwort vergessen per E-Mail', () => {
  it('schickt einen Link, mit dem sich das Passwort genau einmal setzen lässt', async () => {
    await start(true);
    const status = (await ctx.app.inject({ url: '/api/auth/status' })).json<AuthStatus>();
    expect(status.passwordResetMail).toBe(true);

    const res = await post('/api/auth/forgot', { login: 'anna@example.org' });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('anna@example.org');
    expect(sent[0]!.text).toContain(`https://dash.example.org${RESET_PATH}#token=`);
    const token = tokenFrom(sent[0]!.text);

    const check = await post('/api/auth/reset/check', { token });
    expect(check.json()).toEqual({ username: 'anna' });

    const reset = await post('/api/auth/reset', { token, password: NEW_PASSWORD });
    expect(reset.statusCode).toBe(200);
    expect(String(reset.headers['set-cookie'])).toContain('ud_session=');
    expect(await login(PASSWORD)).toBe(401);
    expect(await login(NEW_PASSWORD)).toBe(200);

    // Der Link ist verbraucht.
    expect((await post('/api/auth/reset', { token, password: PASSWORD })).statusCode).toBe(400);
  });

  it('antwortet bei unbekannten Konten gleich und verschickt nichts', async () => {
    await start(true);
    const res = await post('/api/auth/forgot', { login: 'niemand' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(0);
  });

  it('begrenzt Mails pro Konto', async () => {
    await start(true);
    for (let i = 0; i < 5; i++) await post('/api/auth/forgot', { login: 'anna' });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(3);
  });

  it('lehnt ungültige Links ab', async () => {
    await start(true);
    const res = await post('/api/auth/reset/check', { token: 'x'.repeat(43) });
    expect(res.statusCode).toBe(400);
  });
});

describe('Passwort vergessen ohne Mailversand', () => {
  it('meldet die Anfrage dem Admin, der einen Link erzeugt', async () => {
    const { admin, anna } = await start(false);
    await post('/api/auth/forgot', { login: 'anna' });
    expect(sent).toHaveLength(0);

    const users = (await ctx.app.inject({ url: '/api/users', headers: { cookie: admin } })).json<
      User[]
    >();
    expect(users.find((u) => u.id === anna.id)!.resetRequestedAt).not.toBeNull();

    const link = await post(`/api/users/${anna.id}/reset-link`, {}, admin);
    expect(link.statusCode).toBe(201);
    const { token } = link.json<ResetLink>();
    expect((await post('/api/auth/reset', { token, password: NEW_PASSWORD })).statusCode).toBe(200);
    expect(await login(NEW_PASSWORD)).toBe(200);

    const after = (await ctx.app.inject({ url: '/api/users', headers: { cookie: admin } })).json<
      User[]
    >();
    expect(after.find((u) => u.id === anna.id)!.resetRequestedAt).toBeNull();
  });

  it('macht ältere Links ungültig, wenn ein neuer erzeugt wird', async () => {
    const { admin, anna } = await start(false);
    const first = (await post(`/api/users/${anna.id}/reset-link`, {}, admin)).json<ResetLink>();
    await post(`/api/users/${anna.id}/reset-link`, {}, admin);
    expect((await post('/api/auth/reset/check', { token: first.token })).statusCode).toBe(400);
  });

  it('erlaubt Reset-Links nur für Admins', async () => {
    const { anna } = await start(false);
    const res = await post('/api/auth/login', { username: 'anna', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect((await post(`/api/users/${anna.id}/reset-link`, {}, cookie)).statusCode).toBe(403);
  });
});

describe('E-Mail-Adressen', () => {
  it('lässt Benutzer ihre eigene Adresse ändern und verhindert doppelte', async () => {
    const { admin } = await start(false);
    const res = await post('/api/auth/login', { username: 'anna', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const own = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/email',
      headers: { cookie },
      payload: { email: 'anna@neu.example' },
    });
    expect(own.json<User>().email).toBe('anna@neu.example');

    const clash = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'bernd', password: PASSWORD, email: 'anna@neu.example' },
    });
    expect(clash.statusCode).toBe(400);

    const invalid = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/email',
      headers: { cookie },
      payload: { email: 'keine-adresse' },
    });
    expect(invalid.statusCode).toBe(400);

    const cleared = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/email',
      headers: { cookie },
      payload: { email: '' },
    });
    expect(cleared.json<User>().email).toBeNull();
  });
});

describe('Kommandozeile', () => {
  it('erzeugt einen Reset-Link für einen Benutzer', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ud-cli-'));
    const config = { ...baseConfig, databaseFile: join(dir, 'test.db') };
    try {
      const app = await buildApp(config, { logger: false, startMonitor: false });
      await app.app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { username: 'admin', password: PASSWORD },
      });
      await app.app.close();

      const lines: string[] = [];
      expect(runCli(['reset-link', 'admin'], config, (l) => lines.push(l))).toBe(0);
      const token = tokenFrom(lines.join('\n'));
      expect(runCli(['reset-link', 'gibtsnicht'], config, () => undefined)).toBe(1);

      ctx = await buildApp(config, { logger: false, startMonitor: false });
      const check = await post('/api/auth/reset/check', { token });
      expect(check.json()).toEqual({ username: 'admin' });
    } finally {
      await ctx?.app.close();
      ctx = undefined as never;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

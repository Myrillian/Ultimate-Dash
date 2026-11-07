import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { AuditEntry, AuthStatus, MailSettings } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { MailConfig, MailServerConfig } from '../auth/mailer.js';
import type { AppConfig } from '../config.js';

const PASSWORD = 'ein-langes-passwort';
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
  mail: null,
  publicUrl: null,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let created: MailServerConfig[] = [];
let sent: { to: string; subject: string; text: string }[] = [];
let failure: (Error & { code?: string }) | null = null;

async function start(overrides: Partial<AppConfig> = {}) {
  created = [];
  sent = [];
  failure = null;
  ctx = await buildApp(
    { ...config, ...overrides },
    {
      logger: false,
      startMonitor: false,
      createMailer: (server) => {
        created.push(server);
        return {
          async send(message) {
            if (failure) throw failure;
            sent.push(message);
          },
          async verify() {
            if (failure) throw failure;
          },
        };
      },
    },
  );
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'admin', password: PASSWORD },
  });
  cookie = String(res.headers['set-cookie']).split(';')[0]!;
}

beforeEach(() => start());
afterEach(() => ctx.app.close());

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  as = cookie,
) => ctx.app.inject({ method, url, payload, headers: { cookie: as } });

const valid = {
  host: 'mail.example.org',
  port: 587,
  encryption: 'starttls',
  user: 'dash@example.org',
  password: 'geheim',
  from: 'Ultimate Dash <dash@example.org>',
  publicUrl: 'https://dash.example.org/',
};

describe('Mailserver-Einstellungen', () => {
  it('ist ohne Einstellungen nicht eingerichtet', async () => {
    const res = await call('GET', '/api/mail/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json<MailSettings>()).toMatchObject({ host: null, source: null });
    const status = await ctx.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.json<AuthStatus>().passwordResetMail).toBe(false);
  });

  it('speichert, gibt das Passwort nie zurück und schaltet den Reset per Mail ein', async () => {
    const res = await call('PUT', '/api/mail/settings', valid);
    expect(res.statusCode).toBe(200);
    const settings = res.json<MailSettings>();
    expect(settings).toMatchObject({
      host: 'mail.example.org',
      port: 587,
      encryption: 'starttls',
      user: 'dash@example.org',
      hasPassword: true,
      publicUrl: 'https://dash.example.org',
      source: 'settings',
    });
    expect(JSON.stringify(settings)).not.toContain('geheim');
    expect(JSON.stringify((await call('GET', '/api/mail/settings')).json())).not.toContain(
      'geheim',
    );

    const status = await ctx.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.json<AuthStatus>().passwordResetMail).toBe(true);

    const audit = await call('GET', '/api/audit');
    expect(audit.json<AuditEntry[]>().map((e) => e.action)).toContain('mail.connect');
  });

  it('behält das Passwort, wenn das Feld leer bleibt', async () => {
    await call('PUT', '/api/mail/settings', valid);
    const res = await call('PUT', '/api/mail/settings', { ...valid, port: 2525, password: '' });
    expect(res.statusCode).toBe(200);
    expect(created.at(-1)).toMatchObject({ port: 2525, password: 'geheim' });
  });

  it('übernimmt das Passwort nicht für einen anderen Benutzer', async () => {
    await call('PUT', '/api/mail/settings', valid);
    const res = await call('PUT', '/api/mail/settings', {
      ...valid,
      user: 'anderer@example.org',
      password: '',
    });
    expect(res.statusCode).toBe(400);
  });

  it('lehnt ungültige Eingaben ab', async () => {
    const res = await call('PUT', '/api/mail/settings', {
      ...valid,
      host: 'https://mail.example.org',
      port: 70000,
      from: 'kein absender',
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json<{ issues: { path: string[] }[] }>().issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['host', 'port', 'from']));
  });

  it('verlangt ohne PUBLIC_URL die Adresse des Dashboards', async () => {
    const res = await call('PUT', '/api/mail/settings', { ...valid, publicUrl: '' });
    expect(res.statusCode).toBe(400);
  });

  it('speichert nicht, wenn der Mailserver die Anmeldung ablehnt', async () => {
    failure = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
    const res = await call('PUT', '/api/mail/settings', valid);
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: string }>().error).toContain('abgelehnt');
    expect((await call('GET', '/api/mail/settings')).json<MailSettings>().host).toBeNull();
  });

  it('schickt eine Testmail, ohne zu speichern', async () => {
    const res = await call('POST', '/api/mail/test', {
      ...valid,
      encryption: 'tls',
      port: 465,
      to: 'admin@example.org',
    });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'admin@example.org', subject: 'Ultimate Dash: Testmail' });
    expect(sent[0]!.text).toContain('SSL/TLS');
    expect((await call('GET', '/api/mail/settings')).json<MailSettings>().host).toBeNull();
  });

  it('meldet einen nicht erreichbaren Mailserver beim Test', async () => {
    failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' });
    const res = await call('POST', '/api/mail/test', { ...valid, to: 'admin@example.org' });
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: string }>().error).toContain('nicht erreichbar');
  });

  it('trennt den Mailserver wieder', async () => {
    await call('PUT', '/api/mail/settings', valid);
    expect((await call('DELETE', '/api/mail/settings')).statusCode).toBe(204);
    const status = await ctx.app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.json<AuthStatus>().passwordResetMail).toBe(false);
  });

  it('ist nur für Admins', async () => {
    await call('POST', '/api/users', { username: 'anna', password: PASSWORD });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'anna', password: PASSWORD },
    });
    const anna = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/mail/settings', undefined, anna)).statusCode).toBe(403);
    expect((await call('POST', '/api/mail/test', valid, anna)).statusCode).toBe(403);
  });

  it('zeigt einen per Umgebung festgelegten Mailserver nur an', async () => {
    await ctx.app.close();
    const env: MailConfig = {
      host: 'smtp.env.example',
      port: 465,
      encryption: 'tls',
      user: 'env',
      password: 'env-geheim',
      from: 'dash@env.example',
      tlsInsecure: false,
      publicUrl: 'https://env.example',
    };
    await start({ mail: env });
    const settings = (await call('GET', '/api/mail/settings')).json<MailSettings>();
    expect(settings).toMatchObject({ source: 'env', host: 'smtp.env.example', hasPassword: true });
    expect(JSON.stringify(settings)).not.toContain('env-geheim');
    expect((await call('PUT', '/api/mail/settings', valid)).statusCode).toBe(409);
  });

  it('nimmt PUBLIC_URL aus der Umgebung, wenn gesetzt', async () => {
    await ctx.app.close();
    await start({ publicUrl: 'https://fest.example' });
    const res = await call('PUT', '/api/mail/settings', { ...valid, publicUrl: '' });
    expect(res.statusCode).toBe(200);
    expect(res.json<MailSettings>()).toMatchObject({
      publicUrl: 'https://fest.example',
      publicUrlFromEnv: true,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditEntry, UpdateStatus } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import type { UpdateConfig } from '../update/service.js';

const PASSWORD = 'ein-langes-passwort';

const releases = [
  {
    tag_name: 'v0.3.0-rc.1',
    prerelease: true,
    body: 'Vorabversion',
    html_url: 'https://github.com/x/y/releases/tag/v0.3.0-rc.1',
  },
  {
    tag_name: 'v0.2.0',
    name: 'Version 0.2.0',
    body: '- Neue Update-Prüfung',
    html_url: 'https://github.com/x/y/releases/tag/v0.2.0',
    published_at: '2026-11-12T08:00:00Z',
  },
  {
    tag_name: 'v0.1.1',
    body: '- Fehlerbehebung',
    html_url: 'javascript:alert(1)',
  },
  {
    tag_name: 'v0.1.0',
    body: 'Erste Version',
    html_url: 'https://github.com/x/y/releases/tag/v0.1.0',
  },
  { tag_name: 'draft', draft: true, body: '' },
];

let ctx: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let dir = '';
let calls = 0;
let githubStatus = 200;

function baseConfig(update: UpdateConfig): AppConfig {
  return {
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
    update,
  };
}

async function start(overrides: Partial<UpdateConfig> = {}) {
  calls = 0;
  githubStatus = 200;
  dir = mkdtempSync(join(tmpdir(), 'ud-update-'));
  ctx = await buildApp(
    baseConfig({
      version: '0.1.0',
      checkEnabled: true,
      repo: 'x/y',
      selfUpdate: {
        requestFile: join(dir, 'update', 'request'),
        statusFile: join(dir, 'status.json'),
      },
      ...overrides,
    }),
    {
      logger: false,
      startMonitor: false,
      updateFetch: (async () => {
        calls++;
        return new Response(JSON.stringify(releases), { status: githubStatus });
      }) as typeof fetch,
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
afterEach(async () => {
  await ctx.app.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (method: 'GET' | 'POST', url: string, payload?: object, as = cookie) =>
  ctx.app.inject({ method, url, payload, headers: { cookie: as } });

describe('Update-Prüfung', () => {
  it('meldet die neuere Version mit Änderungsprotokoll', async () => {
    const status = (await call('GET', '/api/update')).json<UpdateStatus>();
    expect(status).toMatchObject({
      currentVersion: '0.1.0',
      mode: 'self',
      updateAvailable: true,
      error: null,
    });
    expect(status.latest?.version).toBe('0.2.0');
    expect(status.latest?.body).toContain('Update-Prüfung');
    // Vorabversionen und Entwürfe zählen nicht, die installierte Version ebenfalls nicht.
    expect(status.releases.map((r) => r.version)).toEqual(['0.2.0', '0.1.1']);
    // Ungültige Links werden verworfen.
    expect(status.releases[1]!.url).toBe('');
  });

  it('fragt GitHub nur einmal pro Stunde, außer bei „Jetzt prüfen“', async () => {
    await call('GET', '/api/update');
    await call('GET', '/api/update');
    expect(calls).toBe(1);
    await call('POST', '/api/update/check');
    expect(calls).toBe(2);
  });

  it('zeigt Fehler von GitHub verständlich an', async () => {
    githubStatus = 403;
    const status = (await call('GET', '/api/update')).json<UpdateStatus>();
    expect(status.error).toContain('begrenzt');
    expect(status.updateAvailable).toBe(false);
  });

  it('ist nur für Admins', async () => {
    await call('POST', '/api/users', { username: 'anna', password: PASSWORD });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'anna', password: PASSWORD },
    });
    const anna = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/update', undefined, anna)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/update/install', { version: '0.2.0', acknowledged: true }, anna))
        .statusCode,
    ).toBe(403);
    expect(existsSync(join(dir, 'update', 'request'))).toBe(false);
  });
});

describe('Update-Installation', () => {
  it('verlangt die ausdrückliche Bestätigung des Änderungsprotokolls', async () => {
    const res = await call('POST', '/api/update/install', { version: '0.2.0' });
    expect(res.statusCode).toBe(400);
    const no = await call('POST', '/api/update/install', { version: '0.2.0', acknowledged: false });
    expect(no.statusCode).toBe(400);
    expect(existsSync(join(dir, 'update', 'request'))).toBe(false);
  });

  it('nimmt nur die neueste geprüfte Version an', async () => {
    for (const version of ['0.1.1', '9.9.9', 'main', '0.2.0; reboot']) {
      const res = await call('POST', '/api/update/install', { version, acknowledged: true });
      expect(res.statusCode).toBe(400);
    }
    expect(existsSync(join(dir, 'update', 'request'))).toBe(false);
  });

  it('schreibt die Anfrage, protokolliert sie und lehnt eine zweite ab', async () => {
    const res = await call('POST', '/api/update/install', {
      version: 'v0.2.0',
      acknowledged: true,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json<UpdateStatus>().progress).toMatchObject({ state: 'queued', version: 'v0.2.0' });
    expect(readFileSync(join(dir, 'update', 'request'), 'utf8')).toBe('v0.2.0\n');

    const again = await call('POST', '/api/update/install', {
      version: '0.2.0',
      acknowledged: true,
    });
    expect(again.statusCode).toBe(409);

    const audit = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(audit.map((e) => e.action)).toContain('update.install');
  });

  it('zeigt einen fehlgeschlagenen Lauf und blendet einen erfolgreichen aus', async () => {
    writeFileSync(
      join(dir, 'status.json'),
      JSON.stringify({ state: 'failed', version: 'v0.2.0', message: 'Build fehlgeschlagen' }),
    );
    expect((await call('GET', '/api/update')).json<UpdateStatus>().progress).toMatchObject({
      state: 'failed',
      message: 'Build fehlgeschlagen',
    });
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ state: 'ok', version: 'v0.2.0' }));
    expect((await call('GET', '/api/update')).json<UpdateStatus>().progress).toBeNull();
  });

  it('ist ohne Update-Dienst (Docker) nur eine Anzeige', async () => {
    await ctx.app.close();
    await start({ selfUpdate: null });
    const status = (await call('GET', '/api/update')).json<UpdateStatus>();
    expect(status).toMatchObject({ mode: 'manual', updateAvailable: true });
    expect(status.manualHint).toContain('docker compose');
    const res = await call('POST', '/api/update/install', { version: '0.2.0', acknowledged: true });
    expect(res.statusCode).toBe(409);
  });

  it('fragt GitHub nicht, wenn die Prüfung abgeschaltet ist', async () => {
    await ctx.app.close();
    await start({ checkEnabled: false });
    const status = (await call('GET', '/api/update')).json<UpdateStatus>();
    expect(status).toMatchObject({ mode: 'disabled', updateAvailable: false, latest: null });
    expect(calls).toBe(0);
  });
});

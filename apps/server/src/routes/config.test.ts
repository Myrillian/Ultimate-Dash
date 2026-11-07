import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { DashboardData, ImportSummary } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';

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

const call = (method: 'GET' | 'POST', url: string, payload?: object, as = cookie) =>
  ctx.app.inject({ method, url, payload, headers: { cookie: as } });

const dashboard = async () => (await call('GET', '/api/dashboard')).json<DashboardData>();

const importYaml = async (yaml: string, mode: 'replace' | 'merge', dryRun = false) =>
  call('POST', '/api/config/import', { yaml, mode, dryRun });

const SAMPLE = `
version: 1
title: Mein Homelab
groups:
  - name: Infrastruktur
    services:
      - name: Proxmox
        url: https://pve.home.lan:8006
        icon: di:proxmox
        tags: [vm, homelab]
      - name: Technitium
        url: http://10.10.0.53:5380
        statusCheck: false
  - name: Smart Home
    collapsed: true
    services:
      - name: Home Assistant
        url: http://ha.home.lan:8123
        target: _self
`;

describe('YAML-Export und -Import', () => {
  it('importiert eine Datei und exportiert sie ohne Standardwerte wieder', async () => {
    const res = await importYaml(SAMPLE, 'replace');
    expect(res.statusCode).toBe(200);
    expect(res.json<ImportSummary>()).toMatchObject({ groupsCreated: 2, servicesCreated: 3 });

    const data = await dashboard();
    expect(data.title).toBe('Mein Homelab');
    expect(data.groups.map((g) => g.name)).toEqual(['Infrastruktur', 'Smart Home']);
    expect(data.groups[0]!.services[0]).toMatchObject({
      icon: 'di:proxmox',
      tags: ['vm', 'homelab'],
    });

    const exported = await call('GET', '/api/config/export');
    expect(exported.headers['content-type']).toContain('yaml');
    expect(exported.headers['content-disposition']).toMatch(
      /ultimate-dash-\d{4}-\d{2}-\d{2}\.yaml/,
    );
    const file = parse(exported.body);
    expect(file.groups[0].services[1]).toEqual({
      name: 'Technitium',
      url: 'http://10.10.0.53:5380',
      statusCheck: false,
    });
    expect(file.groups[1]).toMatchObject({ collapsed: true });

    // Rundreise: erneuter Import ergibt denselben Stand
    await importYaml(exported.body, 'replace');
    expect((await dashboard()).groups).toHaveLength(2);
  });

  it('gleicht beim Zusammenführen per Name ab und löscht nichts', async () => {
    await importYaml(SAMPLE, 'replace');
    const res = await importYaml(
      `version: 1
groups:
  - name: infrastruktur
    services:
      - name: PROXMOX
        url: https://pve2.home.lan:8006
      - name: NAS
        url: http://nas.home.lan
  - name: Medien
    services: []
`,
      'merge',
    );
    expect(res.json<ImportSummary>()).toMatchObject({
      groupsCreated: 1,
      groupsUpdated: 1,
      servicesCreated: 1,
      servicesUpdated: 1,
      titleChanged: false,
    });
    const data = await dashboard();
    expect(data.groups.map((g) => g.name)).toEqual(['infrastruktur', 'Smart Home', 'Medien']);
    const infra = data.groups[0]!.services;
    expect(infra.map((s) => s.name)).toEqual(['PROXMOX', 'Technitium', 'NAS']);
    expect(infra[0]!.url).toBe('https://pve2.home.lan:8006');
  });

  it('ändert bei einer Probe nichts und meldet, was ersetzt würde', async () => {
    await importYaml(SAMPLE, 'replace');
    const res = await importYaml('version: 1\ngroups: []\n', 'replace', true);
    expect(res.json<ImportSummary>()).toMatchObject({ groupsRemoved: 2, servicesRemoved: 3 });
    expect((await dashboard()).groups).toHaveLength(2);
  });

  it('meldet kaputtes YAML mit Zeile und ungültige Einträge pro Feld', async () => {
    const broken = await importYaml('version: 1\ngroups:\n  - name: [unclosed\n', 'merge');
    expect(broken.statusCode).toBe(400);
    expect(broken.json().error).toMatch(/kein gültiges YAML/);

    const invalid = await importYaml(
      'version: 1\ngroups:\n  - name: A\n    services:\n      - name: X\n        url: ftp://x\n',
      'merge',
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().issues[0].path).toEqual(['groups', 0, 'services', 0, 'url']);
    expect((await dashboard()).groups).toHaveLength(0);
  });

  it('erlaubt Export und Import auch Nur-lesen-Benutzern, aber nur für das eigene Dashboard', async () => {
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-pw' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-pw' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect(
      (await call('POST', '/api/config/import', { yaml: SAMPLE, mode: 'merge' }, viewer))
        .statusCode,
    ).toBe(200);
    const exported = parse((await call('GET', '/api/config/export', undefined, viewer)).body);
    expect(exported.groups[0].name).toBe('Infrastruktur');
    // Das Dashboard des Admins bleibt unberührt.
    expect((await dashboard()).groups).toHaveLength(0);
  });
});

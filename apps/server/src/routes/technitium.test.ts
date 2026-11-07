import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type {
  AuditEntry,
  DhcpLease,
  DhcpScope,
  DnsRecordList,
  DnsSummary,
  DnsZone,
  TechnitiumSettings,
} from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { startFakeTechnitium, type FakeTechnitium } from '../technitium/fake-server.js';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  databaseFile: ':memory:',
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  webRoot: null,
  statusIntervalSeconds: 60,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
  technitium: null,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let fake: FakeTechnitium;
let cookie = '';

beforeEach(async () => {
  fake = await startFakeTechnitium();
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

const connect = () => call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });

describe('Technitium-Verbindung', () => {
  it('meldet ohne Verbindung „nicht verbunden“', async () => {
    const res = await call('GET', '/api/technitium/summary');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'not-configured' });
    expect((await call('GET', '/api/technitium/settings')).json()).toMatchObject({
      url: null,
      hasToken: false,
    });
  });

  it('speichert nur funktionierende Zugangsdaten und gibt das Token nie heraus', async () => {
    const wrong = await call('PUT', '/api/technitium/settings', { url: fake.url, token: 'falsch' });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json().error).toMatch(/Token ist ungültig/);

    const ok = await connect();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ version: '13.6', serverDomain: 'dns.home.lan' });
    expect(fake.requests.at(-1)!.authorization).toBe(`Bearer ${fake.token}`);

    const settings = await call('GET', '/api/technitium/settings');
    expect(settings.json<TechnitiumSettings>()).toEqual({
      url: fake.url,
      hasToken: true,
      tlsInsecure: false,
      source: 'settings',
    });
    expect(settings.body).not.toContain(fake.token);

    // Leeres Token beim erneuten Speichern behält das bisherige.
    const again = await call('PUT', '/api/technitium/settings', { url: `${fake.url}/`, token: '' });
    expect(again.statusCode).toBe(200);
  });

  it('übersetzt Netzwerkfehler in verständliche Meldungen', async () => {
    const closed = await startFakeTechnitium();
    await closed.close();
    const res = await call('POST', '/api/technitium/test', { url: closed.url, token: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/lehnt die Verbindung ab/);
  });

  it('liefert eine aufbereitete Zusammenfassung und puffert sie kurz', async () => {
    await connect();
    const res = await call('GET', '/api/technitium/summary?range=hour');
    expect(res.statusCode).toBe(200);
    const summary = res.json<DnsSummary>();
    expect(summary.series.labels).toHaveLength(60);
    expect(summary.series.queries).toHaveLength(60);
    expect(summary.totals.queries).toBeGreaterThan(summary.totals.blocked);
    expect(summary.queryTypes.map((q) => q.name)).toEqual(['A', 'AAAA', 'HTTPS', 'PTR', 'SRV']);
    expect(summary.topClients[0]).toEqual({
      name: '10.10.0.21',
      domain: 'desktop.home.lan',
      hits: 812,
    });
    expect(summary.topClients[2]!.domain).toBeNull();
    expect(summary.blocking).toMatchObject({ enabled: true, pausedUntil: null, listCount: 2 });
    expect(summary.blocking.blockedDomains).toBe(287_458);

    const before = fake.requests.length;
    await call('GET', '/api/technitium/summary?range=hour');
    expect(fake.requests.length).toBe(before);
  });

  it('steuert das Blocking und protokolliert jede Änderung', async () => {
    await connect();
    expect(
      (await call('POST', '/api/technitium/blocking', { action: 'pause', minutes: 15 })).statusCode,
    ).toBe(204);
    let blocking = (await call('GET', '/api/technitium/summary')).json<DnsSummary>().blocking;
    expect(blocking.enabled).toBe(false);
    const remaining = Date.parse(blocking.pausedUntil!) - Date.now();
    expect(remaining).toBeGreaterThan(14 * 60_000);
    expect(remaining).toBeLessThanOrEqual(15 * 60_000);

    await call('POST', '/api/technitium/blocking', { action: 'enable' });
    blocking = (await call('GET', '/api/technitium/summary')).json<DnsSummary>().blocking;
    expect(blocking).toMatchObject({ enabled: true, pausedUntil: null });

    await call('POST', '/api/technitium/blocking', { action: 'update-lists' });
    expect(fake.state.listUpdates).toBe(1);

    fake.allowedPaths = new Set(['settings/get', 'dashboard/stats/get']);
    const denied = await call('POST', '/api/technitium/blocking', { action: 'disable' });
    expect(denied.statusCode).toBe(502);
    expect(denied.json()).toMatchObject({ code: 'permission' });

    const log = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(log.map((e) => [e.action, e.ok])).toEqual([
      ['technitium.blocking.disable', false],
      ['technitium.blocking.update-lists', true],
      ['technitium.blocking.enable', true],
      ['technitium.blocking.pause', true],
      ['technitium.connect', true],
    ]);
    expect((await call('GET', '/api/audit?limit=2')).json<AuditEntry[]>()).toHaveLength(2);
    expect((await call('GET', '/api/audit?limit=0')).statusCode).toBe(400);
    expect(log[0]).toMatchObject({ username: 'admin' });
  });

  it('erlaubt Nur-lesen-Benutzern nur das Ansehen der Statistik', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-pw' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-pw' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/technitium/summary', undefined, viewer)).statusCode).toBe(200);
    expect((await call('GET', '/api/technitium/settings', undefined, viewer)).statusCode).toBe(403);
    expect((await call('GET', '/api/audit', undefined, viewer)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/technitium/blocking', { action: 'disable' }, viewer)).statusCode,
    ).toBe(403);
  });
});

describe('DNS-Records', () => {
  const zone = 'home.lan';
  const list = async () =>
    (await call('GET', `/api/technitium/records?zone=${zone}`)).json<DnsRecordList>();
  const find = (records: DnsRecordList, domain: string, type: string) =>
    records.records.find((r) => r.domain === domain && r.type === type);

  it('listet Zonen: eigene, Reverse, interne und Records ohne SOA', async () => {
    await connect();
    const zones = (await call('GET', '/api/technitium/zones')).json<DnsZone[]>();
    expect(zones.map((z) => z.name)).toEqual(['home.lan', '10.10.10.in-addr.arpa', 'localhost']);
    expect(zones[2]!.internal).toBe(true);

    const records = await list();
    expect(records.zone.name).toBe('home.lan');
    expect(records.records.some((r) => r.type === 'SOA')).toBe(false);
    expect(find(records, 'nas.home.lan', 'A')).toMatchObject({
      ttl: 3600,
      display: '10.10.10.20',
      comments: 'Synology',
      data: { type: 'A', ipAddress: '10.10.10.20' },
    });
    expect(find(records, '_sip._tcp.home.lan', 'SRV')!.display).toBe('1 5 5060 pbx.home.lan');
    // Unbekannte Typen werden angezeigt, aber nicht bearbeitbar
    expect(find(records, 'app.home.lan', 'ANAME')).toMatchObject({
      data: null,
      display: 'nas.home.lan',
    });
  });

  it('legt Records an und lehnt Duplikate und ungültige Werte ab', async () => {
    await connect();
    const body = {
      zone,
      domain: 'test.home.lan',
      ttl: 600,
      comments: 'Test',
      data: { type: 'A', ipAddress: '10.10.10.99' },
    };
    expect((await call('POST', '/api/technitium/records', body)).statusCode).toBe(204);
    expect(find(await list(), 'test.home.lan', 'A')).toMatchObject({ ttl: 600, comments: 'Test' });

    const duplicate = await call('POST', '/api/technitium/records', body);
    expect(duplicate.statusCode).toBe(502);
    expect(duplicate.json().error).toMatch(/already exists/);

    const invalid = await call('POST', '/api/technitium/records', {
      ...body,
      data: { type: 'A', ipAddress: 'nicht-ip' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().issues[0].path).toEqual(['data', 'ipAddress']);
  });

  it('ändert Wert, Name, TTL und Status eines Records', async () => {
    await connect();
    const update = await call('PUT', '/api/technitium/records', {
      zone,
      domain: 'nas2.home.lan',
      ttl: 120,
      comments: null,
      disabled: true,
      data: { type: 'A', ipAddress: '10.10.10.21' },
      current: { domain: 'nas.home.lan', data: { type: 'A', ipAddress: '10.10.10.20' } },
    });
    expect(update.statusCode).toBe(204);
    const records = await list();
    expect(find(records, 'nas.home.lan', 'A')).toBeUndefined();
    expect(find(records, 'nas2.home.lan', 'A')).toMatchObject({
      ttl: 120,
      disabled: true,
      comments: null,
      display: '10.10.10.21',
    });

    // CNAME und MX haben eigene Parameternamen beim Ändern
    await call('PUT', '/api/technitium/records', {
      zone,
      domain: 'wiki.home.lan',
      ttl: 3600,
      data: { type: 'CNAME', cname: 'pve.home.lan' },
      current: { domain: 'wiki.home.lan', data: { type: 'CNAME', cname: 'nas.home.lan' } },
    });
    await call('PUT', '/api/technitium/records', {
      zone,
      domain: 'home.lan',
      ttl: 3600,
      data: { type: 'MX', preference: 20, exchange: 'mx2.home.lan' },
      current: {
        domain: 'home.lan',
        data: { type: 'MX', preference: 10, exchange: 'mail.home.lan' },
      },
    });
    const after = await list();
    expect(find(after, 'wiki.home.lan', 'CNAME')!.display).toBe('pve.home.lan');
    expect(find(after, 'home.lan', 'MX')!.display).toBe('20 mx2.home.lan');

    const typeChange = await call('PUT', '/api/technitium/records', {
      zone,
      domain: 'pve.home.lan',
      ttl: 300,
      data: { type: 'CNAME', cname: 'x.home.lan' },
      current: { domain: 'pve.home.lan', data: { type: 'A', ipAddress: '10.10.10.10' } },
    });
    expect(typeChange.statusCode).toBe(502);
  });

  it('löscht genau den gewählten Record und protokolliert alles', async () => {
    await connect();
    const del = (domain: string, data: object) =>
      call('POST', '/api/technitium/records/delete', { zone, domain, data });
    expect((await del('pve.home.lan', { type: 'A', ipAddress: '10.10.10.10' })).statusCode).toBe(
      204,
    );
    const records = await list();
    expect(find(records, 'pve.home.lan', 'A')).toBeUndefined();
    expect(find(records, 'pve.home.lan', 'AAAA')).toBeDefined();

    expect((await del('wiki.home.lan', { type: 'CNAME', cname: 'nas.home.lan' })).statusCode).toBe(
      204,
    );
    expect(
      (await del('gibt-es-nicht.home.lan', { type: 'A', ipAddress: '1.2.3.4' })).statusCode,
    ).toBe(502);

    const log = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(log.slice(0, 3).map((e) => [e.action, e.ok, e.target])).toEqual([
      ['technitium.record.delete', false, 'A gibt-es-nicht.home.lan → 1.2.3.4'],
      ['technitium.record.delete', true, 'CNAME wiki.home.lan → nas.home.lan'],
      ['technitium.record.delete', true, 'A pve.home.lan → 10.10.10.10'],
    ]);
  });

  it('lässt Nur-lesen-Benutzer Records ansehen, aber nicht ändern', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-pw' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-pw' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect(
      (await call('GET', `/api/technitium/records?zone=${zone}`, undefined, viewer)).statusCode,
    ).toBe(200);
    const body = {
      zone,
      domain: 'x.home.lan',
      ttl: 60,
      data: { type: 'A', ipAddress: '10.0.0.1' },
    };
    expect((await call('POST', '/api/technitium/records', body, viewer)).statusCode).toBe(403);
    expect((await call('POST', '/api/technitium/records/delete', body, viewer)).statusCode).toBe(
      403,
    );
  });
});

describe('DHCP', () => {
  const scopes = async () => (await call('GET', '/api/technitium/dhcp/scopes')).json<DhcpScope[]>();
  const leases = async () => (await call('GET', '/api/technitium/dhcp/leases')).json<DhcpLease[]>();
  const reservation = {
    scope: 'LAN',
    hardwareAddress: 'aa:bb:cc:00:00:09',
    ipAddress: '10.10.10.30',
    hostName: 'drucker',
    comments: 'Flur',
  };

  it('liest Scopes mit Details und Leases', async () => {
    await connect();
    const list = await scopes();
    expect(list.map((s) => [s.name, s.enabled])).toEqual([
      ['IoT', false],
      ['LAN', true],
    ]);
    const lan = list.find((s) => s.name === 'LAN')!;
    expect(lan).toMatchObject({
      startingAddress: '10.10.10.1',
      routerAddress: '10.10.10.1',
      leaseMinutes: 1440 + 720,
      dnsServers: ['10.10.10.2'],
      exclusions: [{ startingAddress: '10.10.10.1', endingAddress: '10.10.10.99' }],
    });
    expect(lan.reservations).toEqual([
      {
        hardwareAddress: 'AA-BB-CC-00-00-01',
        address: '10.10.10.20',
        hostName: 'nas',
        comments: 'Synology',
      },
    ]);
    const all = await leases();
    expect(all).toHaveLength(3);
    expect(all.find((l) => l.address === '10.10.10.102')).toMatchObject({
      server: 'main',
      type: 'Dynamic',
      hostName: null,
      obtained: '2026-11-06T08:00:00.123Z',
      expires: '2026-11-07T20:00:00.765Z',
    });
  });

  describe('mit zweitem Technitium-Server', () => {
    let second: FakeTechnitium;
    beforeEach(async () => {
      second = await startFakeTechnitium(0, 'zweites-token');
      // Der zweite Server bedient ein eigenes Netz mit eigenen Leases.
      second.dhcp.scopes = [
        {
          name: 'Gäste',
          enabled: true,
          startingAddress: '10.10.30.100',
          endingAddress: '10.10.30.200',
          subnetMask: '255.255.255.0',
          routerAddress: '10.10.30.1',
          domainName: 'gast.home.lan',
          exclusions: [],
          reservedLeases: [
            {
              hostName: 'tv',
              hardwareAddress: 'AA-BB-CC-00-00-31',
              address: '10.10.30.150',
              comments: null,
            },
          ],
        },
      ];
      second.dhcp.leases = [
        {
          scope: 'Gäste',
          type: 'Dynamic',
          hardwareAddress: 'AA-BB-CC-00-00-30',
          address: '10.10.30.101',
          hostName: 'handy',
        },
      ];
    });
    afterEach(() => second.close());

    const addSecond = (body: object = {}) =>
      call('POST', '/api/technitium/dhcp/servers', {
        name: 'dns2',
        url: second.url,
        token: second.token,
        ...body,
      });

    it('liest Scopes, Leases und Reservierungen beider Server', async () => {
      await connect();
      const added = await addSecond();
      expect(added.statusCode).toBe(200);
      const id = added.json().id as string;
      expect(added.body).not.toContain(second.token);

      const list = await scopes();
      expect(list.map((s) => [s.name, s.server === 'main' ? 'main' : 'zweiter'])).toEqual([
        ['Gäste', 'zweiter'],
        ['IoT', 'main'],
        ['LAN', 'main'],
      ]);
      expect(list[0]).toMatchObject({ server: id, serverName: 'dns2' });
      expect(list[0]!.reservations).toHaveLength(1);

      const all = await leases();
      expect(all).toHaveLength(4);
      expect(all.find((l) => l.address === '10.10.30.101')).toMatchObject({
        server: id,
        serverName: 'dns2',
        type: 'Dynamic',
      });

      // Änderungen gehen an den Server, der den Scope bedient.
      expect(
        (
          await call('POST', '/api/technitium/dhcp/leases/action', {
            server: id,
            scope: 'Gäste',
            hardwareAddress: 'AA-BB-CC-00-00-30',
            action: 'reserve',
          })
        ).statusCode,
      ).toBe(204);
      expect(second.dhcp.leases[0]!.type).toBe('Reserved');
      expect(fake.dhcp.leases.every((l) => l.scope !== 'Gäste')).toBe(true);

      const unknown = await call('POST', '/api/technitium/dhcp/scopes/state', {
        server: 'gibt-es-nicht',
        scope: 'LAN',
        enabled: false,
      });
      expect(unknown.statusCode).toBe(404);
    });

    it('nutzt ohne eigenes Token das der Hauptverbindung', async () => {
      await connect();
      second.token = fake.token;
      const added = await addSecond({ token: '' });
      expect(added.statusCode).toBe(200);
      expect(added.json()).toMatchObject({ ownToken: false, primary: false });
      expect(second.requests.at(-1)!.authorization).toBe(`Bearer ${fake.token}`);
    });

    it('prüft neue Server und lehnt Doppelte ab', async () => {
      await connect();
      const wrong = await addSecond({ token: 'falsch' });
      expect(wrong.statusCode).toBe(502);
      expect(wrong.json().error).toMatch(/Token ist ungültig/);
      expect((await addSecond({ url: fake.url })).statusCode).toBe(400);
      await addSecond();
      expect((await addSecond()).statusCode).toBe(400);
      const servers = (await call('GET', '/api/technitium/dhcp/servers')).json();
      expect(servers).toHaveLength(2);
      expect(servers[0]).toMatchObject({ id: 'main', primary: true });
    });

    it('zeigt den Hauptserver weiter an, wenn der zweite ausfällt', async () => {
      await connect();
      const id = (await addSecond()).json().id as string;
      await second.close();
      const list = await scopes();
      expect(list.map((s) => s.name)).toEqual(['IoT', 'LAN']);
      const servers = (await call('GET', '/api/technitium/dhcp/servers')).json();
      expect(servers.find((s: { id: string }) => s.id === id).error).toMatch(/lehnt|erreichbar/);

      // Entfernen
      expect((await call('DELETE', `/api/technitium/dhcp/servers/${id}`)).statusCode).toBe(204);
      expect((await call('GET', '/api/technitium/dhcp/servers')).json()).toHaveLength(1);
      second = await startFakeTechnitium();
    });
  });

  it('schaltet einen Scope ein und aus', async () => {
    await connect();
    expect(
      (await call('POST', '/api/technitium/dhcp/scopes/state', { scope: 'IoT', enabled: true }))
        .statusCode,
    ).toBe(204);
    expect((await scopes()).find((s) => s.name === 'IoT')!.enabled).toBe(true);
    const missing = await call('POST', '/api/technitium/dhcp/scopes/state', {
      scope: 'Nix',
      enabled: true,
    });
    expect(missing.statusCode).toBe(502);
  });

  it('legt Reservierungen an und normalisiert die MAC', async () => {
    await connect();
    expect((await call('POST', '/api/technitium/dhcp/reservations', reservation)).statusCode).toBe(
      204,
    );
    const lan = (await scopes()).find((s) => s.name === 'LAN')!;
    expect(lan.reservations.find((r) => r.address === '10.10.10.30')).toEqual({
      hardwareAddress: 'AA-BB-CC-00-00-09',
      address: '10.10.10.30',
      hostName: 'drucker',
      comments: 'Flur',
    });

    const duplicate = await call('POST', '/api/technitium/dhcp/reservations', {
      ...reservation,
      ipAddress: '10.10.10.31',
    });
    expect(duplicate.statusCode).toBe(502);
    expect(duplicate.json().error).toMatch(/already exists/);

    const invalid = await call('POST', '/api/technitium/dhcp/reservations', {
      ...reservation,
      hardwareAddress: 'xyz',
      ipAddress: '10.10.10',
    });
    expect(invalid.statusCode).toBe(400);
    expect(
      invalid
        .json()
        .issues.map((i: { path: string[] }) => i.path[0])
        .sort(),
    ).toEqual(['hardwareAddress', 'ipAddress']);
  });

  it('ändert eine Reservierung und stellt sie bei einem Fehler wieder her', async () => {
    await connect();
    const update = (body: object) => call('PUT', '/api/technitium/dhcp/reservations', body);
    const ok = await update({
      scope: 'LAN',
      currentHardwareAddress: 'AA-BB-CC-00-00-01',
      hardwareAddress: 'AA-BB-CC-00-00-01',
      ipAddress: '10.10.10.21',
      hostName: 'nas',
      comments: 'Neu',
    });
    expect(ok.statusCode).toBe(204);
    let lan = (await scopes()).find((s) => s.name === 'LAN')!;
    expect(lan.reservations).toEqual([
      {
        hardwareAddress: 'AA-BB-CC-00-00-01',
        address: '10.10.10.21',
        hostName: 'nas',
        comments: 'Neu',
      },
    ]);

    // Zweite Reservierung anlegen und dann auf die IP der ersten ändern: Technitium lehnt ab.
    await call('POST', '/api/technitium/dhcp/reservations', reservation);
    const clash = await update({
      ...reservation,
      currentHardwareAddress: reservation.hardwareAddress,
      ipAddress: '10.10.10.21',
    });
    expect(clash.statusCode).toBe(502);
    lan = (await scopes()).find((s) => s.name === 'LAN')!;
    expect(lan.reservations.find((r) => r.hardwareAddress === 'AA-BB-CC-00-00-09')).toMatchObject({
      address: '10.10.10.30',
      hostName: 'drucker',
      comments: 'Flur',
    });
    expect(lan.reservations).toHaveLength(2);

    const gone = await update({ ...reservation, currentHardwareAddress: 'AA-BB-CC-99-99-99' });
    expect(gone.statusCode).toBe(502);
    expect(gone.json().error).toMatch(/existiert nicht mehr/);
  });

  it('wandelt Leases um, gibt sie frei und löscht Reservierungen', async () => {
    await connect();
    const action = (hardwareAddress: string, name: string) =>
      call('POST', '/api/technitium/dhcp/leases/action', {
        scope: 'LAN',
        hardwareAddress,
        action: name,
      });
    expect((await action('AA-BB-CC-00-00-02', 'reserve')).statusCode).toBe(204);
    expect((await leases()).find((l) => l.hardwareAddress === 'AA-BB-CC-00-00-02')!.type).toBe(
      'Reserved',
    );
    expect((await scopes()).find((s) => s.name === 'LAN')!.reservations).toHaveLength(2);

    expect((await action('AA-BB-CC-00-00-02', 'unreserve')).statusCode).toBe(204);
    expect((await action('AA-BB-CC-00-00-03', 'remove')).statusCode).toBe(204);
    expect((await leases()).map((l) => l.hardwareAddress)).not.toContain('AA-BB-CC-00-00-03');

    const del = await call('POST', '/api/technitium/dhcp/reservations/delete', {
      scope: 'LAN',
      hardwareAddress: 'aa-bb-cc-00-00-01',
    });
    expect(del.statusCode).toBe(204);
    expect((await scopes()).find((s) => s.name === 'LAN')!.reservations).toHaveLength(0);

    const log = (await call('GET', '/api/audit')).json<AuditEntry[]>();
    expect(log.slice(0, 4).map((e) => [e.action, e.target])).toEqual([
      ['technitium.dhcp.reservation.delete', 'AA-BB-CC-00-00-01'],
      ['technitium.dhcp.lease.remove', 'AA-BB-CC-00-00-03'],
      ['technitium.dhcp.lease.unreserve', 'AA-BB-CC-00-00-02'],
      ['technitium.dhcp.lease.reserve', 'AA-BB-CC-00-00-02'],
    ]);
  });

  it('lässt Nur-lesen-Benutzer ansehen, aber nicht ändern', async () => {
    await connect();
    await call('POST', '/api/users', { username: 'gast', password: 'noch-ein-langes-pw' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'noch-ein-langes-pw' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await call('GET', '/api/technitium/dhcp/scopes', undefined, viewer)).statusCode).toBe(
      200,
    );
    expect((await call('GET', '/api/technitium/dhcp/leases', undefined, viewer)).statusCode).toBe(
      200,
    );
    expect(
      (await call('POST', '/api/technitium/dhcp/reservations', reservation, viewer)).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/api/technitium/dhcp/scopes/state',
          { scope: 'LAN', enabled: false },
          viewer,
        )
      ).statusCode,
    ).toBe(403);
  });
});

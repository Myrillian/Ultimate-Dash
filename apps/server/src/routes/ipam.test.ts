import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type {
  IpamCategory,
  IpamData,
  IpamIpDetail,
  IpamNetwork,
  IpamReachability,
  IpamScanStatus,
  IpamSync,
  IpamUsage,
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
  feedIntervalMinutes: 30,
  statusTimeoutMs: 1000,
  logLevel: 'silent',
  oidc: null,
  technitium: null,
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let fake: FakeTechnitium;
let cookie = '';
/** Adressen, die im Test auf Ping antworten */
let alive = new Set<string>();

beforeEach(async () => {
  fake = await startFakeTechnitium();
  alive = new Set();
  ctx = await buildApp(config, {
    logger: false,
    startMonitor: false,
    pinger: async (address) => alive.has(address),
  });
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

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: { cookie } });

const lan = { name: 'LAN', cidr: '10.10.10.0/24', vlanId: 10, gateway: '10.10.10.1' };

async function setup() {
  const network = (await call('POST', '/api/ipam/networks', lan)).json<IpamNetwork>();
  const servers = (
    await call('POST', '/api/ipam/categories', { name: 'Server', color: 'blue' })
  ).json<IpamCategory>();
  const clients = (
    await call('POST', '/api/ipam/categories', { name: 'Clients', color: 'orange' })
  ).json<IpamCategory>();
  return { network, servers, clients };
}

const range = (networkId: number, categoryId: number, startAddress: string, endAddress: string) =>
  call('POST', '/api/ipam/ranges', { networkId, categoryId, startAddress, endAddress });

describe('IPAM verwalten', () => {
  it('legt Netze, Kategorien und Bereiche an und listet sie', async () => {
    const { network, servers } = await setup();
    expect((await range(network.id, servers.id, '10.10.10.2', '10.10.10.19')).statusCode).toBe(201);
    const data = (await call('GET', '/api/ipam')).json<IpamData>();
    expect(data.networks).toHaveLength(1);
    expect(data.categories.map((c) => c.name)).toEqual(['Server', 'Clients']);
    expect(data.ranges[0]).toMatchObject({ startAddress: '10.10.10.2', endAddress: '10.10.10.19' });
  });

  it('lehnt ungültige und überlappende Netze ab', async () => {
    await setup();
    expect(
      (await call('POST', '/api/ipam/networks', { name: 'x', cidr: '10.10.10.5/24' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/ipam/networks', { name: 'x', cidr: '10.0.0.0/8' })).statusCode,
    ).toBe(400);
    const clash = await call('POST', '/api/ipam/networks', {
      name: 'Sub',
      cidr: '10.10.10.128/25',
    });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error).toContain('LAN');
    const gw = await call('POST', '/api/ipam/networks', {
      name: 'IoT',
      cidr: '10.10.20.0/24',
      gateway: '10.10.30.1',
    });
    expect(gw.statusCode).toBe(400);
  });

  it('lehnt Bereiche außerhalb des Netzes, verkehrte und überlappende ab', async () => {
    const { network, servers, clients } = await setup();
    expect((await range(network.id, servers.id, '10.10.11.1', '10.10.11.5')).statusCode).toBe(400);
    expect((await range(network.id, servers.id, '10.10.10.20', '10.10.10.10')).statusCode).toBe(
      400,
    );
    expect((await range(network.id, servers.id, '10.10.10.2', '10.10.10.19')).statusCode).toBe(201);
    const overlap = await range(network.id, clients.id, '10.10.10.19', '10.10.10.50');
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().error).toContain('Überschneidet');
  });

  it('verhindert, ein Netz unter seine Bereiche zu verkleinern', async () => {
    const { network, servers } = await setup();
    await range(network.id, servers.id, '10.10.10.200', '10.10.10.210');
    const res = await call('PUT', `/api/ipam/networks/${network.id}`, {
      ...lan,
      cidr: '10.10.10.0/25',
    });
    expect(res.statusCode).toBe(400);
  });

  it('löscht Bereiche mit ihrer Kategorie und mit dem Netz', async () => {
    const { network, servers } = await setup();
    await range(network.id, servers.id, '10.10.10.2', '10.10.10.19');
    expect((await call('DELETE', `/api/ipam/categories/${servers.id}`)).statusCode).toBe(204);
    expect((await call('GET', '/api/ipam')).json<IpamData>().ranges).toHaveLength(0);
    expect((await call('DELETE', `/api/ipam/networks/${network.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/ipam/networks/${network.id}`)).statusCode).toBe(404);
  });

  it('doppelter Kategoriename wird abgelehnt', async () => {
    await setup();
    expect(
      (await call('POST', '/api/ipam/categories', { name: 'server', color: 'red' })).statusCode,
    ).toBe(400);
  });

  it('Lesende dürfen anzeigen, aber nicht ändern; Änderungen stehen im Audit-Log', async () => {
    await setup();
    const audit = (await call('GET', '/api/audit')).json<{ action: string }[]>();
    expect(audit.map((a) => a.action)).toContain('ipam.network.create');

    await call('POST', '/api/users', {
      username: 'gast',
      password: 'ein-langes-passwort',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'ein-langes-passwort' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/ipam',
      headers: { cookie: viewer },
    });
    expect(read.statusCode).toBe(200);
    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/ipam/categories',
      payload: { name: 'X', color: 'red' },
      headers: { cookie: viewer },
    });
    expect(write.statusCode).toBe(403);
  });
});

describe('IPAM-Belegung', () => {
  it('meldet ohne Technitium „nicht verfügbar“', async () => {
    await setup();
    const usage = (await call('GET', '/api/ipam/usage')).json<IpamUsage>();
    expect(usage.available).toBe(false);
    expect(usage.reason).toContain('nicht verbunden');
  });

  it('führt Reservierungen, Leases und DNS zusammen', async () => {
    const { network, servers, clients } = await setup();
    await range(network.id, servers.id, '10.10.10.2', '10.10.10.50');
    await range(network.id, clients.id, '10.10.10.100', '10.10.10.199');
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });

    const usage = (await call('GET', '/api/ipam/usage')).json<IpamUsage>();
    expect(usage.available).toBe(true);
    const u = usage.networks[network.id]!;
    expect(u.hosts).toBe(254);
    const byIp = Object.fromEntries(u.addresses.map((a) => [a.address, a]));
    // Reservierung + DNS-A-Eintrag desselben Geräts: eine Adresse, mehrere Quellen
    expect(byIp['10.10.10.20']!.claims.map((c) => c.source).sort()).toEqual(['dns', 'reservation']);
    expect(byIp['10.10.10.10']!.claims.map((c) => c.source)).toEqual(['dns']);
    expect(byIp['10.10.10.101']).toBeDefined();
    expect(u.used).toBe(u.addresses.length);
    expect(
      u.rangeUse[servers.id === 0 ? 0 : Object.keys(u.rangeUse).map(Number)[0]!]!.used,
    ).toBeGreaterThan(0);
    expect(u.conflicts).toBe(0);
    expect(u.pools.length).toBeGreaterThan(0);
  });

  it('erkennt zwei Geräte auf einer Adresse als Konflikt', async () => {
    const { network } = await setup();
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
    // Dynamische Lease auf der Adresse einer fremden Reservierung
    await call('POST', '/api/technitium/dhcp/reservations', {
      scope: 'LAN',
      hardwareAddress: 'AA-BB-CC-DD-EE-01',
      ipAddress: '10.10.10.101',
    });
    const usage = (await call('GET', '/api/ipam/usage')).json<IpamUsage>();
    const u = usage.networks[network.id]!;
    expect(u.addresses.find((a) => a.address === '10.10.10.101')!.conflict).toBe(true);
    expect(u.conflicts).toBe(1);
  });
});

describe('IPAM mit zwei Technitium-Servern', () => {
  it('zeigt Leases des zweiten Servers als Lease statt als statisch', async () => {
    const { network } = await setup();
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
    // Ohne den zweiten Server kennt das IPAM für 10.10.10.10 nur den DNS-Eintrag.
    let u = (await call('GET', '/api/ipam/usage')).json<IpamUsage>().networks[network.id]!;
    expect(u.addresses.find((a) => a.address === '10.10.10.10')!.type).toBe('static');

    const second = await startFakeTechnitium(0, 'zweites-token');
    try {
      second.dhcp.scopes = [{ ...fake.dhcp.scopes[0]!, reservedLeases: [] }];
      second.dhcp.leases = [
        {
          scope: 'LAN',
          type: 'Dynamic',
          hardwareAddress: 'AA-BB-CC-00-00-10',
          address: '10.10.10.10',
          hostName: 'router',
        },
      ];
      const added = await call('POST', '/api/technitium/dhcp/servers', {
        name: 'dns2',
        url: second.url,
        token: second.token,
      });
      expect(added.statusCode).toBe(200);
      u = (await call('GET', '/api/ipam/usage')).json<IpamUsage>().networks[network.id]!;
      expect(u.addresses.find((a) => a.address === '10.10.10.10')!.type).toBe('lease');
      // Reservierungen und Leases des Hauptservers bleiben erhalten.
      expect(u.addresses.find((a) => a.address === '10.10.10.20')!.type).toBe('reservation');

      const d = (await call('GET', '/api/ipam/ip/10.10.10.10')).json<IpamIpDetail>();
      expect(d.dhcp.lease).toMatchObject({ server: added.json().id, scope: 'LAN' });

      // Beide Server bedienen dasselbe Netz: nur ein Vorschlag.
      await call('DELETE', `/api/ipam/networks/${network.id}`);
      const sync = (await call('GET', '/api/ipam/sync')).json<IpamSync>();
      expect(sync.suggestions.filter((x) => x.cidr === '10.10.10.0/24')).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
});

describe('Hersteller', () => {
  it('liefert Hersteller zu Kennungen, auch für Nur-lesen-Benutzer, und ignoriert Ungültiges', async () => {
    await setup();
    const res = await call('GET', '/api/ipam/vendors?prefixes=001132,B827eb,ZZZZZZ,FFFFFF');
    expect(res.statusCode).toBe(200);
    const map = res.json<Record<string, string | null>>();
    expect(map['001132']).toMatch(/Synology/);
    expect(map['B827EB']).toMatch(/Raspberry/);
    expect(map).not.toHaveProperty('ZZZZZZ');
    expect(Object.keys(map)).toHaveLength(3);
  });
});

describe('IP-Detail', () => {
  it('liefert Reservierung, DNS und Reverse-Eintrag zu einer Adresse', async () => {
    const { network, servers } = await setup();
    await range(network.id, servers.id, '10.10.10.2', '10.10.10.50');
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
    const res = await call('GET', '/api/ipam/ip/10.10.10.20');
    expect(res.statusCode).toBe(200);
    const d = res.json<IpamIpDetail>();
    expect(d).toMatchObject({ state: 'used', type: 'reservation', networkId: network.id });
    expect(d.dhcp.reservation?.mac).toBeTruthy();
    expect(d.dns.forward.length).toBeGreaterThan(0);
    expect(d.dns.reverseZone).toBe('10.10.10.in-addr.arpa');
    const ptr = (await call('GET', '/api/ipam/ip/10.10.10.10')).json<IpamIpDetail>();
    expect(ptr.dns.reverse?.zone).toBe('10.10.10.in-addr.arpa');
    expect(ptr.rangeId).toBe(servers.id);
  });

  it('zeigt freie Adressen und lehnt Adressen außerhalb der Netze ab', async () => {
    await setup();
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
    const free = (await call('GET', '/api/ipam/ip/10.10.10.222')).json<IpamIpDetail>();
    expect(free).toMatchObject({ state: 'free', type: null });
    expect((await call('GET', '/api/ipam/ip/192.168.99.5')).statusCode).toBe(404);
    expect((await call('GET', '/api/ipam/ip/kaputt')).statusCode).toBe(400);
  });

  it('zeigt Änderungen in Technitium sofort, ohne auf den Zwischenspeicher zu warten', async () => {
    await setup();
    await call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
    const before = (await call('GET', '/api/ipam/ip/10.10.10.101')).json<IpamIpDetail>();
    expect(before.type).toBe('lease');
    const res = await call('POST', '/api/technitium/dhcp/leases/action', {
      scope: 'LAN',
      hardwareAddress: 'AA-BB-CC-00-00-02',
      action: 'reserve',
    });
    expect(res.statusCode).toBeLessThan(300);
    const after = (await call('GET', '/api/ipam/ip/10.10.10.101')).json<IpamIpDetail>();
    expect(after.type).toBe('reservation');
  });

  it('ist ohne Technitium-Verbindung ein 503', async () => {
    await setup();
    expect((await call('GET', '/api/ipam/ip/10.10.10.20')).statusCode).toBe(503);
  });
});

describe('IPAM-Abgleich mit Technitium', () => {
  const connect = () =>
    call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });

  it('meldet ohne Technitium „nicht verfügbar“', async () => {
    const sync = (await call('GET', '/api/ipam/sync')).json<IpamSync>();
    expect(sync.available).toBe(false);
  });

  it('schlägt Netze aus DHCP-Scopes vor', async () => {
    await connect();
    const sync = (await call('GET', '/api/ipam/sync')).json<IpamSync>();
    expect(sync.suggestions.map((s) => [s.scope, s.cidr, s.gateway])).toEqual([
      ['IoT', '10.10.20.0/24', '10.10.20.1'],
      ['LAN', '10.10.10.0/24', '10.10.10.1'],
    ]);
    const lan = sync.suggestions.find((s) => s.scope === 'LAN')!;
    // Ausschluss .1 bis .99 fällt weg, übrig bleibt .100 bis .254
    expect(lan.pools).toEqual([{ start: '10.10.10.100', end: '10.10.10.254' }]);
  });

  it('übernimmt Scopes als Netze mit DHCP-Kategorie und Bereich', async () => {
    await connect();
    const res = await call('POST', '/api/ipam/import', { scopes: ['LAN'] });
    expect(res.statusCode).toBe(201);
    const data = (await call('GET', '/api/ipam')).json<IpamData>();
    expect(data.networks).toMatchObject([
      { name: 'LAN', cidr: '10.10.10.0/24', gateway: '10.10.10.1' },
    ]);
    expect(data.categories.map((c) => c.name)).toEqual(['DHCP']);
    expect(data.ranges).toMatchObject([
      { startAddress: '10.10.10.100', endAddress: '10.10.10.254' },
    ]);
    // Danach ist LAN keine Empfehlung mehr; die Belegung nutzt den neuen Bereich
    const sync = (await call('GET', '/api/ipam/sync')).json<IpamSync>();
    expect(sync.suggestions.map((s) => s.scope)).toEqual(['IoT']);
    expect(sync.drift).toEqual([]);
    const audit = (await call('GET', '/api/audit')).json<{ action: string }[]>();
    expect(audit.map((a) => a.action)).toContain('ipam.import');
  });

  it('ohne Pool-Bereich legt nur das Netz an', async () => {
    await connect();
    await call('POST', '/api/ipam/import', { scopes: ['IoT'], withPoolRange: false });
    const data = (await call('GET', '/api/ipam')).json<IpamData>();
    expect(data.networks).toHaveLength(1);
    expect(data.categories).toHaveLength(0);
    expect(data.ranges).toHaveLength(0);
  });

  it('lehnt unbekannte oder sich überschneidende Scopes ab', async () => {
    await connect();
    expect((await call('POST', '/api/ipam/import', { scopes: ['Gibt-es-nicht'] })).statusCode).toBe(
      400,
    );
    await call('POST', '/api/ipam/networks', { name: 'Gross', cidr: '10.10.0.0/16' });
    const clash = await call('POST', '/api/ipam/import', { scopes: ['LAN'] });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error).toContain('Gross');
    expect((await call('POST', '/api/ipam/import', { scopes: [] })).statusCode).toBe(400);
  });

  it('zeigt abweichendes Gateway als Abweichung', async () => {
    await connect();
    await call('POST', '/api/ipam/networks', {
      name: 'LAN',
      cidr: '10.10.10.0/24',
      gateway: '10.10.10.254',
    });
    const sync = (await call('GET', '/api/ipam/sync')).json<IpamSync>();
    expect(sync.drift).toEqual([
      {
        networkId: expect.any(Number),
        networkName: 'LAN',
        scope: 'LAN',
        field: 'gateway',
        local: '10.10.10.254',
        remote: '10.10.10.1',
      },
    ]);
  });
});

describe('Ping-Prüfung', () => {
  const connect = () =>
    call('PUT', '/api/technitium/settings', { url: fake.url, token: fake.token });
  const usageOf = async (id: number) =>
    (await call('GET', '/api/ipam/usage')).json<IpamUsage>().networks[id]!;

  it('erkennt Typ je Adresse: Reservierung, Lease, statisch', async () => {
    const { network } = await setup();
    await connect();
    const u = await usageOf(network.id);
    const type = (ip: string) => u.addresses.find((a) => a.address === ip)!.type;
    expect(type('10.10.10.20')).toBe('reservation'); // Reservierung + DNS
    expect(type('10.10.10.101')).toBe('lease');
    expect(type('10.10.10.10')).toBe('static'); // nur DNS
  });

  it('prüft per Ping, entdeckt Unbekanntes und zeigt Offline-Adressen', async () => {
    const { network } = await setup();
    await connect();
    // Vor dem ersten Durchlauf ist nichts bekannt
    expect((await usageOf(network.id)).addresses.every((a) => a.alive === null)).toBe(true);

    alive = new Set(['10.10.10.20', '10.10.10.5']);
    await ctx.scanner.run();

    const u = await usageOf(network.id);
    const byIp = Object.fromEntries(u.addresses.map((a) => [a.address, a]));
    expect(byIp['10.10.10.20']).toMatchObject({ alive: true, discovered: false });
    expect(byIp['10.10.10.10']).toMatchObject({ alive: false, type: 'static' }); // DNS, antwortet nicht
    expect(byIp['10.10.10.5']).toMatchObject({ alive: true, discovered: true, type: 'static' });
    expect(byIp['10.10.10.5']!.claims.map((c) => c.source)).toEqual(['discovered']);
    expect(u.discovered).toBe(1);
    expect(u.online).toBe(2);
    expect(u.lastScanAt).not.toBeNull();
  });

  it('bestätigt Entdeckte, vergisst sie und merkt, wenn sie verschwinden', async () => {
    const { network } = await setup();
    await connect();
    alive = new Set(['10.10.10.5']);
    await ctx.scanner.run();
    const found = (await usageOf(network.id)).addresses.find((a) => a.address === '10.10.10.5')!;
    const hostId = found.claims[0]!.hostId!;

    const ack = await call('PUT', `/api/ipam/hosts/${hostId}`, {
      name: 'Drucker',
      acknowledged: true,
    });
    expect(ack.statusCode).toBe(204);
    let a = (await usageOf(network.id)).addresses.find((x) => x.address === '10.10.10.5')!;
    expect(a).toMatchObject({ discovered: false, claims: [{ source: 'manual', name: 'Drucker' }] });

    // Bestätigte Geräte bleiben belegt, auch wenn sie ausgeschaltet sind
    alive = new Set();
    await ctx.scanner.run();
    a = (await usageOf(network.id)).addresses.find((x) => x.address === '10.10.10.5')!;
    expect(a).toMatchObject({ alive: false, discovered: false });

    expect((await call('DELETE', `/api/ipam/hosts/${hostId}`)).statusCode).toBe(204);
    expect((await usageOf(network.id)).addresses.some((x) => x.address === '10.10.10.5')).toBe(
      false,
    );
    expect((await call('DELETE', `/api/ipam/hosts/${hostId}`)).statusCode).toBe(404);
  });

  it('ein entdecktes Gerät, das nicht mehr antwortet, verschwindet aus der Liste', async () => {
    const { network } = await setup();
    await connect();
    alive = new Set(['10.10.10.5']);
    await ctx.scanner.run();
    alive = new Set();
    await ctx.scanner.run();
    expect((await usageOf(network.id)).addresses.some((x) => x.address === '10.10.10.5')).toBe(
      false,
    );
  });

  it('überspringt Netze mit ausgeschalteter Prüfung', async () => {
    const { network } = await setup();
    await connect();
    await call('PUT', `/api/ipam/networks/${network.id}`, { ...lan, scan: false });
    alive = new Set(['10.10.10.5']);
    await ctx.scanner.run();
    const u = await usageOf(network.id);
    expect(u.lastScanAt).toBeNull();
    expect(u.addresses.some((a) => a.address === '10.10.10.5')).toBe(false);
  });

  it('liefert Erreichbarkeit für die DNS-Ansicht', async () => {
    await setup();
    await connect();
    alive = new Set(['10.10.10.10']);
    await ctx.scanner.run();
    const r = (await call('GET', '/api/ipam/reachability')).json<IpamReachability>();
    expect(r.scanned).toEqual(['10.10.10.0/24']);
    expect(r.hosts['10.10.10.10']).toMatchObject({ alive: true });
  });

  it('Einstellungen prüfen und speichern, Durchlauf auf Abruf', async () => {
    await setup();
    const bad = await call('PUT', '/api/ipam/scan', { enabled: true, intervalMinutes: 1 });
    expect(bad.statusCode).toBe(400);
    const ok = await call('PUT', '/api/ipam/scan', { enabled: true, intervalMinutes: 60 });
    expect(ok.json<IpamScanStatus>()).toMatchObject({ enabled: true, intervalMinutes: 60 });
    expect((await call('GET', '/api/ipam/scan')).json<IpamScanStatus>().intervalMinutes).toBe(60);
    const run = await call('POST', '/api/ipam/scan/run');
    expect(run.statusCode).toBe(202);
    await vi.waitFor(async () =>
      expect((await call('GET', '/api/ipam/scan')).json<IpamScanStatus>().running).toBe(false),
    );
  });

  it('Lesende dürfen Status sehen, aber nichts ändern', async () => {
    await call('POST', '/api/users', { username: 'gast', password: 'ein-langes-passwort' });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'gast', password: 'ein-langes-passwort' },
    });
    const viewer = String(login.headers['set-cookie']).split(';')[0]!;
    const as = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
      ctx.app.inject({ method, url, payload, headers: { cookie: viewer } });
    expect((await as('GET', '/api/ipam/scan')).statusCode).toBe(200);
    expect((await as('POST', '/api/ipam/scan/run')).statusCode).toBe(403);
    expect(
      (await as('PUT', '/api/ipam/scan', { enabled: false, intervalMinutes: 30 })).statusCode,
    ).toBe(403);
  });
});

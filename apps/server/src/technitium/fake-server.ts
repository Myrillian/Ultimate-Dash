import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Simulierter Technitium DNS Server für Tests und lokale Entwicklung.
 * Bildet nur die Endpunkte nach, die Ultimate Dash nutzt, im Antwortformat der echten API.
 */
export interface FakeTechnitium {
  url: string;
  token: string;
  state: {
    enableBlocking: boolean;
    temporaryDisableBlockingTill: string | null;
    listUpdates: number;
  };
  /** DHCP-Stand; Tests dürfen ihn lesen und verändern */
  dhcp: { scopes: FakeScope[]; leases: FakeLease[] };
  /** Records je Zone; Tests dürfen sie lesen und verändern */
  records: Record<string, FakeRecord[]>;
  requests: { path: string; params: Record<string, string>; authorization?: string }[];
  /** Erlaubte Pfade für das Token; null = alles erlaubt */
  allowedPaths: Set<string> | null;
  close(): Promise<void>;
}

export interface FakeRecord {
  name: string;
  type: string;
  ttl: number;
  disabled: boolean;
  comments?: string;
  rData: Record<string, string | number>;
}

export interface FakeScope {
  name: string;
  enabled: boolean;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  routerAddress: string;
  domainName: string;
  exclusions: { startingAddress: string; endingAddress: string }[];
  reservedLeases: {
    hostName: string | null;
    hardwareAddress: string;
    address: string;
    comments: string | null;
  }[];
}

export interface FakeLease {
  scope: string;
  type: 'Dynamic' | 'Reserved';
  hardwareAddress: string;
  address: string;
  hostName: string | null;
}

const seedDhcp = (): FakeTechnitium['dhcp'] => ({
  scopes: [
    {
      name: 'LAN',
      enabled: true,
      startingAddress: '10.10.10.1',
      endingAddress: '10.10.10.254',
      subnetMask: '255.255.255.0',
      routerAddress: '10.10.10.1',
      domainName: 'home.lan',
      exclusions: [{ startingAddress: '10.10.10.1', endingAddress: '10.10.10.99' }],
      reservedLeases: [
        {
          hostName: 'nas',
          hardwareAddress: 'AA-BB-CC-00-00-01',
          address: '10.10.10.20',
          comments: 'Synology',
        },
      ],
    },
    {
      name: 'IoT',
      enabled: false,
      startingAddress: '10.10.20.100',
      endingAddress: '10.10.20.200',
      subnetMask: '255.255.255.0',
      routerAddress: '10.10.20.1',
      domainName: 'iot.home.lan',
      exclusions: [],
      reservedLeases: [],
    },
  ],
  leases: [
    {
      scope: 'LAN',
      type: 'Reserved',
      hardwareAddress: 'AA-BB-CC-00-00-01',
      address: '10.10.10.20',
      hostName: 'nas',
    },
    {
      scope: 'LAN',
      type: 'Dynamic',
      hardwareAddress: 'AA-BB-CC-00-00-02',
      address: '10.10.10.101',
      hostName: 'laptop',
    },
    {
      scope: 'LAN',
      type: 'Dynamic',
      hardwareAddress: 'AA-BB-CC-00-00-03',
      address: '10.10.10.102',
      hostName: null,
    },
  ],
});

const ZONES = [
  { name: 'home.lan', type: 'Primary', internal: false },
  { name: '10.10.10.in-addr.arpa', type: 'Primary', internal: false },
  { name: 'localhost', type: 'Primary', internal: true },
];

const seedRecords = (): Record<string, FakeRecord[]> => ({
  'home.lan': [
    {
      name: 'home.lan',
      type: 'SOA',
      ttl: 3600,
      disabled: false,
      rData: { primaryNameServer: 'dns.home.lan', serial: 1 },
    },
    {
      name: 'home.lan',
      type: 'NS',
      ttl: 3600,
      disabled: false,
      rData: { nameServer: 'dns.home.lan' },
    },
    {
      name: 'nas.home.lan',
      type: 'A',
      ttl: 3600,
      disabled: false,
      comments: 'Synology',
      rData: { ipAddress: '10.10.10.20' },
    },
    {
      name: 'pve.home.lan',
      type: 'A',
      ttl: 300,
      disabled: false,
      rData: { ipAddress: '10.10.10.10' },
    },
    {
      name: 'pve.home.lan',
      type: 'AAAA',
      ttl: 300,
      disabled: false,
      rData: { ipAddress: 'fd00::10' },
    },
    {
      name: 'wiki.home.lan',
      type: 'CNAME',
      ttl: 3600,
      disabled: false,
      rData: { cname: 'nas.home.lan' },
    },
    {
      name: 'home.lan',
      type: 'MX',
      ttl: 3600,
      disabled: false,
      rData: { preference: 10, exchange: 'mail.home.lan' },
    },
    {
      name: 'home.lan',
      type: 'TXT',
      ttl: 3600,
      disabled: false,
      rData: { text: 'v=spf1 -all', splitText: 'false' },
    },
    {
      name: '_sip._tcp.home.lan',
      type: 'SRV',
      ttl: 3600,
      disabled: false,
      rData: { priority: 1, weight: 5, port: 5060, target: 'pbx.home.lan' },
    },
    {
      name: 'app.home.lan',
      type: 'ANAME',
      ttl: 3600,
      disabled: false,
      rData: { dname: 'nas.home.lan' },
    },
  ],
  '10.10.10.in-addr.arpa': [
    {
      name: '10.10.10.10.in-addr.arpa',
      type: 'PTR',
      ttl: 300,
      disabled: false,
      rData: { ptrName: 'pve.home.lan' },
    },
  ],
  localhost: [],
});

const sameValue = (
  record: FakeRecord,
  params: Record<string, string>,
  keys: string[],
  prefix = '',
) =>
  keys.every(
    (key) =>
      String(record.rData[key]) ===
      params[prefix ? prefix + key[0]!.toUpperCase() + key.slice(1) : key],
  );

const VALUE_KEYS: Record<string, string[]> = {
  A: ['ipAddress'],
  AAAA: ['ipAddress'],
  CNAME: [],
  PTR: ['ptrName'],
  MX: ['preference', 'exchange'],
  TXT: ['text'],
  NS: ['nameServer'],
  SRV: ['priority', 'weight', 'port', 'target'],
};

function minuteLabels(count: number): string[] {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  return Array.from({ length: count }, (_, i) =>
    new Date(now - (count - 1 - i) * 60_000).toISOString().replace('Z', '0000Z'),
  );
}

function stats() {
  const labels = minuteLabels(60);
  const total = labels.map((_, i) => 40 + Math.round(25 * Math.sin(i / 6)) + (i % 7) * 3);
  const blocked = total.map((value, i) => Math.round(value * (0.08 + (i % 5) * 0.02)));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const totalQueries = sum(total);
  const totalBlocked = sum(blocked);
  const totalCached = Math.round(totalQueries * 0.46);
  const totalAuthoritative = Math.round(totalQueries * 0.07);
  const totalDropped = 3;
  return {
    stats: {
      totalQueries,
      totalNoError: totalQueries - 120,
      totalServerFailure: 4,
      totalNxDomain: 112,
      totalRefused: 4,
      totalAuthoritative,
      totalRecursive: totalQueries - totalCached - totalAuthoritative - totalBlocked - totalDropped,
      totalCached,
      totalBlocked,
      totalDropped,
      totalClients: 14,
      zones: 6,
      cachedEntries: 5321,
      allowedZones: 2,
      blockedZones: 3,
      allowListZones: 0,
      blockListZones: 287_455,
    },
    mainChartData: {
      labelFormat: 'HH:mm',
      labels,
      datasets: [
        { label: 'Total', data: total },
        { label: 'No Error', data: total },
        { label: 'Blocked', data: blocked },
        { label: 'Clients', data: total.map(() => 9) },
      ],
    },
    queryTypeChartData: {
      labels: ['A', 'AAAA', 'HTTPS', 'PTR', 'SRV', 'TXT'],
      datasets: [{ data: [1520, 830, 410, 96, 12, 0] }],
    },
    topClients: [
      { name: '10.10.0.21', domain: 'desktop.home.lan', hits: 812, rateLimited: false },
      { name: '10.10.0.35', domain: 'tv.home.lan', hits: 655, rateLimited: false },
      { name: '10.10.0.40', hits: 233, rateLimited: false },
    ],
    topDomains: [
      { name: 'connectivitycheck.gstatic.com', hits: 402 },
      { name: 'api.github.com', hits: 288 },
      { name: 'time.cloudflare.com', hits: 120 },
    ],
    topBlockedDomains: [
      { name: 'telemetry.example.net', hits: 140 },
      { name: 'ads.example.com', hits: 77 },
    ],
  };
}

export async function startFakeTechnitium(port = 0, token = 'test-token'): Promise<FakeTechnitium> {
  const fake: Omit<FakeTechnitium, 'url' | 'close'> = {
    token,
    state: { enableBlocking: true, temporaryDisableBlockingTill: null, listUpdates: 0 },
    requests: [],
    allowedPaths: null,
    records: seedRecords(),
    dhcp: seedDhcp(),
  };
  let timer: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const params = Object.fromEntries(
        new URLSearchParams(req.method === 'POST' ? body : url.search),
      );
      const path = url.pathname.replace(/^\/api\//, '');
      fake.requests.push({ path, params, authorization: req.headers.authorization });
      const send = (payload: object) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
      };
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? params.token;
      if (bearer !== fake.token) return send({ status: 'invalid-token' });
      if (fake.allowedPaths && !fake.allowedPaths.has(path))
        return send({ status: 'error', errorMessage: 'Access was denied.' });

      const s = fake.state;
      if (
        s.temporaryDisableBlockingTill &&
        Date.parse(s.temporaryDisableBlockingTill) <= Date.now()
      ) {
        s.enableBlocking = true;
        s.temporaryDisableBlockingTill = null;
      }
      switch (path) {
        case 'settings/get':
          return send({
            status: 'ok',
            response: {
              version: '13.6',
              dnsServerDomain: 'dns.home.lan',
              enableBlocking: s.enableBlocking,
              blockListUrls: ['https://big.oisd.nl/', 'https://example.org/hosts'],
              blockListNextUpdatedOn: new Date(Date.now() + 6 * 3600_000).toISOString(),
              ...(s.temporaryDisableBlockingTill
                ? { temporaryDisableBlockingTill: s.temporaryDisableBlockingTill }
                : {}),
            },
          });
        case 'dashboard/stats/get':
          return send({ status: 'ok', response: stats() });
        case 'settings/temporaryDisableBlocking': {
          const minutes = Number(params.minutes);
          s.enableBlocking = false;
          s.temporaryDisableBlockingTill = new Date(Date.now() + minutes * 60_000).toISOString();
          clearTimeout(timer);
          return send({
            status: 'ok',
            response: { temporaryDisableBlockingTill: s.temporaryDisableBlockingTill },
          });
        }
        case 'settings/set':
          if (params.enableBlocking !== undefined) {
            s.enableBlocking = params.enableBlocking === 'true';
            s.temporaryDisableBlockingTill = null;
          }
          return send({ status: 'ok', response: {} });
        case 'settings/forceUpdateBlockLists':
          s.listUpdates++;
          return send({ status: 'ok' });
        case 'dhcp/scopes/list':
          return send({
            status: 'ok',
            response: {
              scopes: fake.dhcp.scopes.map(
                ({ name, enabled, startingAddress, endingAddress, subnetMask }) => ({
                  name,
                  enabled,
                  startingAddress,
                  endingAddress,
                  subnetMask,
                  networkAddress: startingAddress.replace(/\.\d+$/, '.0'),
                }),
              ),
            },
          });
        case 'dhcp/scopes/get': {
          const scope = fake.dhcp.scopes.find((x) => x.name === params.name);
          if (!scope)
            return send({
              status: 'error',
              errorMessage: `DHCP scope was not found: ${params.name}`,
            });
          return send({
            status: 'ok',
            response: {
              ...scope,
              leaseTimeDays: 1,
              leaseTimeHours: 12,
              leaseTimeMinutes: 0,
              dnsServers: ['10.10.10.2'],
              allowOnlyReservedLeases: false,
            },
          });
        }
        case 'dhcp/scopes/enable':
        case 'dhcp/scopes/disable': {
          const scope = fake.dhcp.scopes.find((x) => x.name === params.name);
          if (!scope)
            return send({
              status: 'error',
              errorMessage: `DHCP scope was not found: ${params.name}`,
            });
          scope.enabled = path.endsWith('enable');
          return send({ status: 'ok', response: {} });
        }
        case 'dhcp/scopes/addReservedLease': {
          const scope = fake.dhcp.scopes.find((x) => x.name === params.name);
          if (!scope)
            return send({
              status: 'error',
              errorMessage: `DHCP scope was not found: ${params.name}`,
            });
          const mac = params.hardwareAddress!.replace(/:/g, '-').toUpperCase();
          if (scope.reservedLeases.some((r) => r.hardwareAddress === mac))
            return send({
              status: 'error',
              errorMessage: `Reserved lease already exists for hardware address: ${mac}`,
            });
          if (scope.reservedLeases.some((r) => r.address === params.ipAddress))
            return send({
              status: 'error',
              errorMessage: `Reserved lease already exists for address: ${params.ipAddress}`,
            });
          scope.reservedLeases.push({
            hostName: params.hostName ?? null,
            hardwareAddress: mac,
            address: params.ipAddress!,
            comments: params.comments ?? null,
          });
          return send({ status: 'ok', response: {} });
        }
        case 'dhcp/scopes/removeReservedLease': {
          const scope = fake.dhcp.scopes.find((x) => x.name === params.name);
          const mac = params.hardwareAddress?.replace(/:/g, '-').toUpperCase();
          const index = scope?.reservedLeases.findIndex((r) => r.hardwareAddress === mac) ?? -1;
          if (!scope || index < 0)
            return send({ status: 'error', errorMessage: 'The reserved lease does not exists.' });
          scope.reservedLeases.splice(index, 1);
          return send({ status: 'ok', response: {} });
        }
        case 'dhcp/leases/list':
          return send({
            status: 'ok',
            response: {
              leases: fake.dhcp.leases.map((l) => ({
                ...l,
                clientIdentifier: '1-' + l.hardwareAddress.replace(/-/g, '').toLowerCase(),
                leaseObtained: '11/06/2026 08:00:00',
                leaseExpires: '11/07/2026 20:00:00',
              })),
            },
          });
        case 'dhcp/leases/convertToReserved':
        case 'dhcp/leases/convertToDynamic':
        case 'dhcp/leases/remove': {
          const mac = params.hardwareAddress?.replace(/:/g, '-').toUpperCase();
          const index = fake.dhcp.leases.findIndex(
            (l) => l.scope === params.name && l.hardwareAddress === mac,
          );
          const lease = fake.dhcp.leases[index];
          const scope = fake.dhcp.scopes.find((x) => x.name === params.name);
          if (!lease || !scope)
            return send({ status: 'error', errorMessage: 'The lease was not found.' });
          if (path.endsWith('remove')) {
            fake.dhcp.leases.splice(index, 1);
            scope.reservedLeases = scope.reservedLeases.filter((r) => r.hardwareAddress !== mac);
          } else if (path.endsWith('convertToReserved')) {
            lease.type = 'Reserved';
            scope.reservedLeases.push({
              hostName: lease.hostName,
              hardwareAddress: mac!,
              address: lease.address,
              comments: null,
            });
          } else {
            lease.type = 'Dynamic';
            scope.reservedLeases = scope.reservedLeases.filter((r) => r.hardwareAddress !== mac);
          }
          return send({ status: 'ok', response: {} });
        }
        case 'zones/list':
          return send({
            status: 'ok',
            response: {
              zones: ZONES.map((z) => ({ ...z, dnssecStatus: 'Unsigned', disabled: false })),
            },
          });
        case 'zones/records/get': {
          const zone = ZONES.find((z) => z.name === params.zone);
          if (!zone)
            return send({
              status: 'error',
              errorMessage: `No such zone was found: ${params.zone}`,
            });
          return send({
            status: 'ok',
            response: {
              zone: { ...zone, disabled: false },
              records: fake.records[zone.name] ?? [],
            },
          });
        }
        case 'zones/records/add': {
          const list = fake.records[params.zone!];
          if (!list)
            return send({
              status: 'error',
              errorMessage: `No such zone was found: ${params.zone}`,
            });
          const keys = VALUE_KEYS[params.type!] ?? [];
          const rData = Object.fromEntries(
            keys.map((k) => [
              k,
              /^\d+$/.test(params[k]!) && k !== 'text' ? Number(params[k]) : params[k]!,
            ]),
          );
          if (params.type === 'CNAME') rData.cname = params.cname!;
          if (
            list.some(
              (r) =>
                r.name === params.domain && r.type === params.type && sameValue(r, params, keys),
            )
          )
            return send({
              status: 'error',
              errorMessage: 'Cannot add record: record already exists.',
            });
          list.push({
            name: params.domain!,
            type: params.type!,
            ttl: Number(params.ttl ?? 3600),
            disabled: false,
            ...(params.comments ? { comments: params.comments } : {}),
            rData,
          });
          return send({ status: 'ok', response: {} });
        }
        case 'zones/records/update': {
          const list = fake.records[params.zone!] ?? [];
          const keys = VALUE_KEYS[params.type!] ?? [];
          const record = list.find(
            (r) => r.name === params.domain && r.type === params.type && sameValue(r, params, keys),
          );
          if (!record)
            return send({
              status: 'error',
              errorMessage: 'Cannot update record: record does not exist.',
            });
          for (const key of keys) {
            const next = params['new' + key[0]!.toUpperCase() + key.slice(1)];
            if (next !== undefined)
              record.rData[key] = /^\d+$/.test(next) && key !== 'text' ? Number(next) : next;
          }
          if (params.type === 'CNAME') record.rData.cname = params.cname!;
          if (params.newDomain) record.name = params.newDomain;
          record.ttl = Number(params.ttl ?? record.ttl);
          record.disabled = params.disable === 'true';
          record.comments = params.comments || undefined;
          // Wie Technitium: mit ptr=true wird der PTR-Eintrag zur Adresse angelegt oder angepasst.
          if (params.type === 'A' && params.ptr === 'true') {
            const ip = String(record.rData.ipAddress);
            const ptrName = `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
            const reverse = Object.entries(fake.records).find(
              ([zone]) => zone.endsWith('.in-addr.arpa') && ptrName.endsWith(`.${zone}`),
            )?.[1];
            const existing = reverse?.find((r) => r.name === ptrName && r.type === 'PTR');
            if (existing) existing.rData.ptrName = record.name;
            else
              reverse?.push({
                name: ptrName,
                type: 'PTR',
                ttl: record.ttl,
                disabled: false,
                rData: { ptrName: record.name },
              });
          }
          return send({ status: 'ok', response: {} });
        }
        case 'zones/records/delete': {
          const list = fake.records[params.zone!] ?? [];
          const keys = VALUE_KEYS[params.type!] ?? [];
          const index = list.findIndex(
            (r) => r.name === params.domain && r.type === params.type && sameValue(r, params, keys),
          );
          if (index < 0)
            return send({
              status: 'error',
              errorMessage: 'Cannot delete record: record does not exist.',
            });
          list.splice(index, 1);
          return send({ status: 'ok' });
        }
        default:
          return send({ status: 'error', errorMessage: `Unbekannter Pfad ${path}` });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

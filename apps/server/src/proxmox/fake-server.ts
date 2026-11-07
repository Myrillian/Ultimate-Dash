import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RawResource, RawRrdPoint } from './summary.js';

/**
 * Simulierter Proxmox VE (ein Knoten „pve“) für Tests und lokale Entwicklung.
 * Bildet nur die lesenden Endpunkte nach, die Ultimate Dash nutzt, im Format der echten API.
 */
export interface FakeProxmox {
  url: string;
  tokenId: string;
  secret: string;
  /** Tests dürfen den Stand lesen und verändern */
  resources: RawResource[];
  permissions: Record<string, Record<string, number>>;
  requests: { method: string; path: string; authorization?: string }[];
  close(): Promise<void>;
}

const GiB = 1024 ** 3;

const seedResources = (): RawResource[] => [
  {
    id: 'node/pve',
    type: 'node',
    node: 'pve',
    status: 'online',
    cpu: 0.23,
    maxcpu: 16,
    mem: 41 * GiB,
    maxmem: 128 * GiB,
    uptime: 864_000,
  },
  {
    id: 'qemu/100',
    type: 'qemu',
    vmid: 100,
    name: 'homeassistant',
    node: 'pve',
    status: 'running',
    diskread: 1_000_000,
    diskwrite: 2_000_000,
  },
  {
    id: 'qemu/101',
    type: 'qemu',
    vmid: 101,
    name: 'opnsense',
    node: 'pve',
    status: 'running',
    diskread: 500_000,
    diskwrite: 100_000,
  },
  { id: 'qemu/105', type: 'qemu', vmid: 105, name: 'windows-test', node: 'pve', status: 'stopped' },
  {
    id: 'qemu/9000',
    type: 'qemu',
    vmid: 9000,
    name: 'debian-vorlage',
    node: 'pve',
    status: 'stopped',
    template: 1,
  },
  {
    id: 'lxc/200',
    type: 'lxc',
    vmid: 200,
    name: 'pihole',
    node: 'pve',
    status: 'running',
    diskread: 0,
    diskwrite: 0,
  },
  {
    id: 'lxc/201',
    type: 'lxc',
    vmid: 201,
    name: 'nextcloud',
    node: 'pve',
    status: 'running',
    diskread: 0,
    diskwrite: 0,
  },
  { id: 'lxc/202', type: 'lxc', vmid: 202, name: 'nextcloud-test', node: 'pve', status: 'stopped' },
  {
    id: 'storage/pve/local',
    type: 'storage',
    storage: 'local',
    node: 'pve',
    status: 'available',
    plugintype: 'dir',
    disk: 30 * GiB,
    maxdisk: 100 * GiB,
    shared: 0,
  },
  {
    id: 'storage/pve/local-lvm',
    type: 'storage',
    storage: 'local-lvm',
    node: 'pve',
    status: 'available',
    plugintype: 'lvmthin',
    disk: 700 * GiB,
    maxdisk: 800 * GiB,
    shared: 0,
  },
  {
    id: 'storage/pve/nas',
    type: 'storage',
    storage: 'nas',
    node: 'pve',
    status: 'available',
    plugintype: 'nfs',
    disk: 2_000 * GiB,
    maxdisk: 8_000 * GiB,
    shared: 1,
  },
];

function rrdPoints(now = Date.now()): RawRrdPoint[] {
  const end = Math.floor(now / 60_000) * 60;
  return Array.from({ length: 70 }, (_, i) => {
    const time = end - (69 - i) * 60;
    // Der letzte Punkt ist bei Proxmox oft noch unvollständig.
    if (i === 69) return { time };
    return {
      time,
      cpu: 0.2 + 0.1 * Math.sin(i / 6),
      netin: 1_500_000 + 500_000 * Math.sin(i / 4),
      netout: 400_000 + 100_000 * Math.cos(i / 5),
    };
  });
}

export async function startFakeProxmox(
  port = 0,
  tokenId = 'dashboard@pve!ultimate-dash',
  secret = 'geheimes-secret',
): Promise<FakeProxmox> {
  const fake = {
    url: '',
    tokenId,
    secret,
    resources: seedResources(),
    permissions: {
      '/': { 'Sys.Audit': 1, 'VM.Audit': 1, 'Datastore.Audit': 1 },
    } as FakeProxmox['permissions'],
    requests: [] as FakeProxmox['requests'],
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const authorization = req.headers.authorization;
    fake.requests.push({ method: req.method ?? '', path: url.pathname, authorization });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (authorization !== `PVEAPIToken=${fake.tokenId}=${fake.secret}`) {
      return send(401, { data: null });
    }
    if (req.method !== 'GET') return send(501, { data: null });
    // Laufende Gäste lesen und schreiben weiter.
    for (const r of fake.resources) {
      if (r.status === 'running' && r.diskread !== undefined) {
        r.diskread += 10_000_000;
        r.diskwrite = (r.diskwrite ?? 0) + 5_000_000;
      }
    }
    const path = url.pathname.replace(/^\/api2\/json/, '');
    if (path === '/version') return send(200, { data: { version: '9.0.3', release: '9.0' } });
    if (path === '/cluster/resources') return send(200, { data: fake.resources });
    if (path === '/access/permissions') return send(200, { data: fake.permissions });
    const rrd = /^\/nodes\/([^/]+)\/rrddata$/.exec(path);
    if (rrd && fake.resources.some((r) => r.type === 'node' && r.node === rrd[1]))
      return send(200, { data: rrdPoints() });
    return send(501, { data: null });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(fake, {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

import { describe, expect, it } from 'vitest';
import type { DashboardGroup, Service } from '@ultimate-dash/shared';
import { searchServices } from './search.js';

let nextId = 1;
const service = (name: string, extra: Partial<Service> = {}): Service => ({
  id: nextId++,
  groupId: 1,
  name,
  url: `https://${name.toLowerCase().replace(/\s/g, '')}.home.lan`,
  description: null,
  icon: null,
  target: '_blank',
  statusCheck: true,
  statusUrl: null,
  tags: [],
  sortOrder: 0,
  ...extra,
});

const groups: DashboardGroup[] = [
  {
    id: 1,
    name: 'Infrastruktur',
    icon: null,
    collapsed: false,
    sortOrder: 0,
    services: [
      service('Proxmox', { description: 'Virtualisierung', url: 'https://pve.home.lan:8006' }),
      service('Technitium', { tags: ['dns', 'dhcp'] }),
    ],
  },
  {
    id: 2,
    name: 'Medien',
    icon: null,
    collapsed: false,
    sortOrder: 1,
    services: [service('Jellyfin'), service('Größenrechner')],
  },
];

const names = (query: string) => searchServices(groups, query).map((hit) => hit.service.name);

describe('searchServices', () => {
  it('findet über Namen, Tags, Host und Beschreibung', () => {
    expect(names('prox')).toEqual(['Proxmox']);
    expect(names('dns')).toEqual(['Technitium']);
    expect(names('pve')).toEqual(['Proxmox']);
    expect(names('virtual')).toEqual(['Proxmox']);
  });

  it('verlangt, dass alle Begriffe passen', () => {
    expect(names('infra dhcp')).toEqual(['Technitium']);
  });

  it('ignoriert Groß-/Kleinschreibung und Umlaute', () => {
    expect(names('GROSSEN')).toEqual(['Größenrechner']);
    expect(names('größen')).toEqual(['Größenrechner']);
    expect(names('grossen')).toEqual(['Größenrechner']);
  });

  it('liefert bei leerer Suche nichts', () => {
    expect(names('   ')).toEqual([]);
  });

  it('sortiert Namenstreffer vor Gruppentreffern', () => {
    expect(names('medien')).toEqual(['Größenrechner', 'Jellyfin']);
    expect(names('j')[0]).toBe('Jellyfin');
  });
});

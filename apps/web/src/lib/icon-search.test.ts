import { describe, expect, it } from 'vitest';
import { searchCatalog } from './icon-search';

const catalog = {
  di: ['proxmox', 'proxmox-dark', 'proxmox-backup-server', 'home-assistant', 'nur-png.png'],
  sh: ['proxmox', 'technitium'],
  updatedAt: new Date().toISOString(),
};

describe('Icon-Suche', () => {
  it('stellt exakte Treffer und Grund-Icons vor Varianten', () => {
    const values = searchCatalog(catalog, 'Proxmox').map((o) => o.value);
    expect(values.slice(0, 2)).toEqual(['di:proxmox', 'sh:proxmox']);
    expect(values.indexOf('di:proxmox-dark')).toBeGreaterThan(values.indexOf('di:proxmox'));
  });

  it('findet mit mehreren Wörtern und blendet Endungen aus', () => {
    expect(searchCatalog(catalog, 'home assistant').map((o) => o.value)).toEqual([
      'di:home-assistant',
    ]);
    expect(searchCatalog(catalog, 'nur png')[0]).toMatchObject({
      value: 'di:nur-png.png',
      label: 'nur-png',
    });
  });

  it('filtert nach Quelle', () => {
    expect(searchCatalog(catalog, 'technitium', ['di'])).toEqual([]);
    expect(searchCatalog(catalog, '', ['sh'])).toHaveLength(2);
  });
});

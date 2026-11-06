import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IconCatalogService, parseDashboardIcons, parseSelfhst } from './catalog.js';

const diTree = {
  svg: ['proxmox.svg', 'technitium.svg'],
  png: ['proxmox.png', 'technitium.png', 'nur-png.png'],
  webp: ['proxmox.webp'],
};
const selfhst = [
  { Reference: 'proxmox', SVG: 'Yes', PNG: 'Yes', Light: 'No', Dark: 'Yes' },
  { Reference: 'altes-logo', SVG: 'No', PNG: 'Yes', Light: 'No', Dark: 'No' },
  { Reference: '../böse', SVG: 'Yes' },
];

describe('Icon-Verzeichnis', () => {
  it('bevorzugt SVG und kennzeichnet reine PNG-Icons mit Endung', () => {
    expect(parseDashboardIcons(diTree)).toEqual(['nur-png.png', 'proxmox', 'technitium']);
    expect(parseDashboardIcons(null)).toEqual([]);
  });

  it('übernimmt selfh.st-Varianten und verwirft ungültige Namen', () => {
    expect(parseSelfhst(selfhst)).toEqual(['altes-logo.png', 'proxmox', 'proxmox-dark']);
    expect(parseSelfhst({})).toEqual([]);
  });

  it('lädt einmal, nutzt den Zwischenspeicher und weicht auf die zweite Quelle aus', async () => {
    const calls: string[] = [];
    const cacheFile = join(mkdtempSync(join(tmpdir(), 'ud-icons-')), 'cache', 'icons.json');
    const fetchJson = async (url: string) => {
      calls.push(url);
      if (url.includes('jsdelivr')) throw new Error('blockiert');
      return url.includes('dashboard-icons') ? diTree : selfhst;
    };
    const service = new IconCatalogService({ cacheFile, fetchJson });
    const first = await service.get();
    expect(first.di).toContain('proxmox');
    expect(first.sh).toContain('proxmox-dark');
    expect(calls).toHaveLength(4);

    await service.get();
    expect(calls).toHaveLength(4);

    // Neuer Start ohne Netz: Stand von der Platte
    const offline = new IconCatalogService({
      cacheFile,
      fetchJson: async () => {
        throw new Error('offline');
      },
    });
    expect((await offline.get()).di).toEqual(first.di);
  });

  it('liefert leere Listen, wenn nie etwas geladen werden konnte', async () => {
    const service = new IconCatalogService({
      cacheFile: null,
      fetchJson: async () => {
        throw new Error('offline');
      },
    });
    const catalog = await service.get();
    expect(catalog).toMatchObject({ di: [], sh: [] });
  });
});

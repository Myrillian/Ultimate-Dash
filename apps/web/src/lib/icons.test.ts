import { describe, expect, it } from 'vitest';
import { initials, resolveIcon } from './icons.js';

describe('resolveIcon', () => {
  it('nutzt URLs und lokale Pfade direkt', () => {
    expect(resolveIcon('https://x.lan/icon.png', 'X')).toEqual({
      kind: 'image',
      src: 'https://x.lan/icon.png',
    });
    expect(resolveIcon('/icons/nas.svg', 'NAS')).toEqual({ kind: 'image', src: '/icons/nas.svg' });
  });

  it('übersetzt Präfixe für Dashboard Icons, selfh.st und Iconify', () => {
    expect(resolveIcon('di:proxmox', 'P')).toMatchObject({
      src: expect.stringContaining('dashboard-icons/svg/proxmox.svg'),
    });
    expect(resolveIcon('sh:technitium', 'T')).toMatchObject({
      src: expect.stringContaining('selfhst/icons/svg/technitium.svg'),
    });
    expect(resolveIcon('di:nur-png.png', 'N')).toMatchObject({
      src: expect.stringContaining('dashboard-icons/png/nur-png.png'),
    });
    expect(resolveIcon('mdi:server-network', 'S')).toEqual({
      kind: 'image',
      src: 'https://api.iconify.design/mdi/server-network.svg',
    });
  });

  it('fällt bei fehlenden oder unbekannten Angaben auf Initialen zurück', () => {
    expect(resolveIcon(null, 'Home Assistant')).toMatchObject({ kind: 'initials', text: 'HA' });
    expect(resolveIcon('kein icon', 'Plex')).toMatchObject({ kind: 'initials', text: 'PL' });
  });
});

describe('initials', () => {
  it('nimmt die Anfangsbuchstaben der ersten beiden Wörter', () => {
    expect(initials('uptime-kuma')).toBe('UK');
    expect(initials('')).toBe('?');
  });
});

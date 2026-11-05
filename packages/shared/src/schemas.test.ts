import { describe, expect, it } from 'vitest';
import { groupInput, serviceInput } from './schemas.js';

describe('serviceInput', () => {
  const base = { groupId: 1, name: 'Proxmox', url: 'https://pve.home.lan:8006' };

  it('setzt sinnvolle Standardwerte', () => {
    const parsed = serviceInput.parse(base);
    expect(parsed).toMatchObject({
      target: '_blank',
      statusCheck: true,
      statusUrl: null,
      description: null,
      icon: null,
      tags: [],
    });
  });

  it('wandelt leere optionale Texte in null um', () => {
    const parsed = serviceInput.parse({ ...base, description: '   ', icon: '' });
    expect(parsed.description).toBeNull();
    expect(parsed.icon).toBeNull();
  });

  it('lehnt andere Protokolle als http und https ab', () => {
    expect(serviceInput.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(serviceInput.safeParse({ ...base, url: 'ftp://nas.lan' }).success).toBe(false);
  });

  it('verlangt einen Namen', () => {
    expect(serviceInput.safeParse({ ...base, name: '  ' }).success).toBe(false);
  });
});

describe('groupInput', () => {
  it('kürzt Leerzeichen und setzt collapsed auf false', () => {
    expect(groupInput.parse({ name: '  Medien ' })).toEqual({
      name: 'Medien',
      icon: null,
      collapsed: false,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { groupInput, serviceInput } from './schemas.js';
import { dnsName, dnsRecordData } from './dns.js';

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

describe('DNS-Records', () => {
  it('prüft Werte je Typ', () => {
    expect(dnsRecordData.safeParse({ type: 'A', ipAddress: '10.10.0.5' }).success).toBe(true);
    expect(dnsRecordData.safeParse({ type: 'A', ipAddress: '10.10.0.999' }).success).toBe(false);
    expect(dnsRecordData.safeParse({ type: 'AAAA', ipAddress: '10.10.0.5' }).success).toBe(false);
    expect(dnsRecordData.safeParse({ type: 'AAAA', ipAddress: 'fd00::5' }).success).toBe(true);
    expect(
      dnsRecordData.safeParse({ type: 'MX', preference: 10, exchange: 'mail.home.lan' }).success,
    ).toBe(true);
  });

  it('entfernt den Schlusspunkt und lehnt Leerzeichen ab', () => {
    expect(dnsName.parse('nas.home.lan.')).toBe('nas.home.lan');
    expect(dnsName.parse('*.home.lan')).toBe('*.home.lan');
    expect(dnsName.safeParse('mein nas.lan').success).toBe(false);
    expect(dnsName.safeParse('-nas.lan').success).toBe(false);
  });
});

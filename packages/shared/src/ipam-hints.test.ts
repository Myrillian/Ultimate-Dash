import { describe, expect, it } from 'vitest';
import { hostLabel, ipamHints, ipamHintsFromClaims } from './ipam-hints.js';

describe('Konsistenzhinweise', () => {
  it('vergleicht nur den ersten Namensteil ohne Groß-/Kleinschreibung', () => {
    expect(hostLabel('NAS.home.lan.')).toBe('nas');
    expect(hostLabel(' nas ')).toBe('nas');
  });

  it('meldet fehlenden DNS-Eintrag nur bei benannten Reservierungen', () => {
    expect(ipamHints({ reservationName: 'nas', dnsNames: [] })).toEqual(['dns-missing']);
    expect(ipamHints({ reservationName: null, dnsNames: [] })).toEqual([]);
    expect(ipamHints({ reservationName: '  ', dnsNames: [] })).toEqual([]);
  });

  it('meldet abweichende Namen, aber nicht bei anderer Zone oder Schreibweise', () => {
    expect(ipamHints({ reservationName: 'nas', dnsNames: ['server.home.lan'] })).toEqual([
      'name-differs',
    ]);
    expect(ipamHints({ reservationName: 'NAS', dnsNames: ['nas.home.lan'] })).toEqual([]);
    expect(
      ipamHints({ reservationName: 'nas', dnsNames: ['alt.home.lan', 'nas.zwei.lan'] }),
    ).toEqual([]);
  });

  it('meldet fehlenden PTR nur, wenn A-Eintrag und Reverse-Zone da sind und der PTR sicher fehlt', () => {
    const base = {
      reservationName: null,
      dnsNames: ['nas.home.lan'],
      reverseZone: '10.in-addr.arpa',
    };
    expect(ipamHints({ ...base, hasPtr: false })).toEqual(['ptr-missing']);
    expect(ipamHints({ ...base, hasPtr: true })).toEqual([]);
    expect(ipamHints(base)).toEqual([]);
    expect(ipamHints({ ...base, reverseZone: null, hasPtr: false })).toEqual([]);
    expect(ipamHints({ ...base, dnsNames: [], hasPtr: false })).toEqual([]);
  });

  it('liest die Hinweise aus den Belegungsdaten', () => {
    const claim = (source: 'reservation' | 'dns' | 'lease', name: string) => ({
      source,
      name,
      mac: null,
      scope: null,
      hostId: null,
    });
    expect(ipamHintsFromClaims([claim('reservation', 'nas')])).toEqual(['dns-missing']);
    expect(ipamHintsFromClaims([claim('lease', 'handy')])).toEqual([]);
    expect(
      ipamHintsFromClaims([claim('reservation', 'nas'), claim('dns', 'andere.home.lan')]),
    ).toEqual(['name-differs']);
  });
});

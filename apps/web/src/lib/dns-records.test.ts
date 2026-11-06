import { describe, expect, it } from 'vitest';
import { draftData, emptyDraft, fieldKey, fullName, relativeName } from './dns-records';

describe('Namen in einer Zone', () => {
  it('zeigt Namen relativ zur Zone', () => {
    expect(relativeName('home.lan', 'home.lan')).toBe('@');
    expect(relativeName('nas.home.lan', 'home.lan')).toBe('nas');
    expect(relativeName('a.b.home.lan', 'home.lan')).toBe('a.b');
    expect(relativeName('fremd.example', 'home.lan')).toBe('fremd.example');
  });

  it('ergänzt die Zone bei der Eingabe nur, wenn sie fehlt', () => {
    expect(fullName('', 'home.lan')).toBe('home.lan');
    expect(fullName('@', 'home.lan')).toBe('home.lan');
    expect(fullName('nas', 'home.lan')).toBe('nas.home.lan');
    expect(fullName('nas.home.lan', 'home.lan')).toBe('nas.home.lan');
    expect(fullName('nas.home.lan.', 'home.lan')).toBe('nas.home.lan');
    expect(fullName('10', '10.10.10.in-addr.arpa')).toBe('10.10.10.10.in-addr.arpa');
  });
});

describe('Formular', () => {
  it('baut die Daten passend zum Typ', () => {
    expect(draftData({ ...emptyDraft('A'), ipAddress: ' 10.0.0.1 ' })).toEqual({
      type: 'A',
      ipAddress: '10.0.0.1',
    });
    expect(draftData({ ...emptyDraft('MX'), exchange: 'mail.x', preference: 5 })).toEqual({
      type: 'MX',
      preference: 5,
      exchange: 'mail.x',
    });
  });

  it('ordnet Serverfehler dem Feld zu', () => {
    expect(fieldKey(['data', 'ipAddress'])).toBe('ipAddress');
    expect(fieldKey(['domain'])).toBe('name');
    expect(fieldKey(['ttl'])).toBe('ttl');
  });
});

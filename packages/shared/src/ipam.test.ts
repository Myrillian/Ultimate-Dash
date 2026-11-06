import { describe, expect, it } from 'vitest';
import { cidrsOverlap, parseCidr, validateRange } from './ipam.js';

describe('parseCidr', () => {
  it('liest gültige Netze', () => {
    expect(parseCidr('10.10.10.0/24')).toMatchObject({ prefix: 24, size: 256 });
    expect(parseCidr('192.168.0.0/16')?.size).toBe(65536);
    expect(parseCidr('10.0.0.4/30')?.size).toBe(4);
  });
  it('lehnt Ungültiges ab', () => {
    for (const bad of [
      '10.10.10.5/24',
      '10.0.0.0/8',
      '10.0.0.0/31',
      '10.0.0.0',
      '300.0.0.0/24',
      'x/24',
    ])
      expect(parseCidr(bad), bad).toBeNull();
  });
  it('erkennt Überschneidungen', () => {
    expect(cidrsOverlap(parseCidr('10.10.0.0/16')!, parseCidr('10.10.5.0/24')!)).toBe(true);
    expect(cidrsOverlap(parseCidr('10.10.4.0/24')!, parseCidr('10.10.5.0/24')!)).toBe(false);
  });
});

describe('validateRange', () => {
  const others = [{ startAddress: '10.0.0.10', endAddress: '10.0.0.20', label: 'Server' }];
  it('akzeptiert passende Bereiche', () => {
    expect(
      validateRange('10.0.0.0/24', others, { startAddress: '10.0.0.21', endAddress: '10.0.0.30' }),
    ).toBeNull();
    expect(
      validateRange('10.0.0.0/24', [], { startAddress: '10.0.0.5', endAddress: '10.0.0.5' }),
    ).toBeNull();
  });
  it('meldet Fehler verständlich', () => {
    expect(
      validateRange('10.0.0.0/24', others, { startAddress: '10.0.0.30', endAddress: '10.0.0.25' }),
    ).toMatch('vor dem Anfang');
    expect(
      validateRange('10.0.0.0/24', others, { startAddress: '10.0.1.1', endAddress: '10.0.1.2' }),
    ).toMatch('nicht in');
    expect(
      validateRange('10.0.0.0/24', others, { startAddress: '10.0.0.15', endAddress: '10.0.0.40' }),
    ).toMatch('Server');
  });
});

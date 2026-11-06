import { describe, expect, it } from 'vitest';
import {
  intToIpv4,
  ipv4InRange,
  ipv4PoolSize,
  ipv4RangeSize,
  ipv4Segments,
  ipv4ToInt,
  isRandomMac,
  macPrefix,
  maskToPrefix,
} from './ip.js';

describe('IPv4-Hilfen', () => {
  it('wandelt Adressen hin und zurück', () => {
    expect(ipv4ToInt('10.10.0.1')).toBe(168427521);
    expect(intToIpv4(168427521)).toBe('10.10.0.1');
    expect(intToIpv4(ipv4ToInt('255.255.255.255')!)).toBe('255.255.255.255');
    expect(ipv4ToInt('10.10.0.256')).toBeNull();
    expect(ipv4ToInt('10.10.0')).toBeNull();
    expect(ipv4ToInt('a.b.c.d')).toBeNull();
  });

  it('prüft Bereiche', () => {
    expect(ipv4InRange('10.10.0.50', '10.10.0.10', '10.10.0.100')).toBe(true);
    expect(ipv4InRange('10.10.0.101', '10.10.0.10', '10.10.0.100')).toBe(false);
    expect(ipv4RangeSize('10.10.0.1', '10.10.0.254')).toBe(254);
    expect(ipv4RangeSize('10.10.0.9', '10.10.0.1')).toBe(0);
  });

  it('zieht Ausschlüsse ab, auch überlappende und überstehende nur einmal', () => {
    const pool = ipv4PoolSize('10.0.0.1', '10.0.0.100', [
      { startingAddress: '10.0.0.1', endingAddress: '10.0.0.10' },
      { startingAddress: '10.0.0.5', endingAddress: '10.0.0.20' },
      { startingAddress: '10.0.0.95', endingAddress: '10.0.0.200' },
    ]);
    expect(pool).toBe(100 - 20 - 6);
  });
});

describe('maskToPrefix', () => {
  it('liest Netzmasken', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('255.255.252.0')).toBe(22);
    expect(maskToPrefix('255.255.255.252')).toBe(30);
    expect(maskToPrefix('0.0.0.0')).toBe(0);
  });
  it('lehnt unzusammenhängende Masken ab', () => {
    expect(maskToPrefix('255.0.255.0')).toBeNull();
    expect(maskToPrefix('nope')).toBeNull();
  });
});

describe('ipv4Segments', () => {
  it('zieht Ausschlüsse ab', () => {
    expect(
      ipv4Segments('10.0.0.1', '10.0.0.254', [
        { startingAddress: '10.0.0.1', endingAddress: '10.0.0.99' },
        { startingAddress: '10.0.0.200', endingAddress: '10.0.0.210' },
      ]),
    ).toEqual([
      { start: '10.0.0.100', end: '10.0.0.199' },
      { start: '10.0.0.211', end: '10.0.0.254' },
    ]);
  });
  it('ohne Ausschlüsse bleibt der ganze Bereich', () => {
    expect(ipv4Segments('10.0.0.5', '10.0.0.9', [])).toEqual([
      { start: '10.0.0.5', end: '10.0.0.9' },
    ]);
  });
});

describe('MAC-Hilfen', () => {
  it('liest die Herstellerkennung', () => {
    expect(macPrefix('00-11-32-aa-bb-cc')).toBe('001132');
    expect(macPrefix('00:11:32:AA:BB:CC')).toBe('001132');
    expect(macPrefix('kaputt')).toBeNull();
  });
  it('erkennt zufällige MAC-Adressen am lokal-verwaltet-Bit', () => {
    expect(isRandomMac('DA-A1-19-00-00-01')).toBe(true);
    expect(isRandomMac('02-00-00-00-00-01')).toBe(true);
    expect(isRandomMac('00-11-32-AA-BB-CC')).toBe(false);
    expect(isRandomMac('kaputt')).toBe(false);
  });
});

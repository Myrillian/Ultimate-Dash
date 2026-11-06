import { describe, expect, it } from 'vitest';
import { intToIpv4, ipv4InRange, ipv4PoolSize, ipv4RangeSize, ipv4ToInt } from './ip.js';

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

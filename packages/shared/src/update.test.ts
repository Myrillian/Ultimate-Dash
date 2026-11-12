import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeVersion, parseVersion, updateInstallInput } from './update.js';

describe('Versionen', () => {
  it('liest Versionen mit und ohne „v“', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
    expect(normalizeVersion('v0.10.0-rc.1')).toBe('0.10.0-rc.1');
  });

  it('lehnt ungültige Angaben ab', () => {
    for (const bad of ['', '1.2', 'latest', '1.2.3; rm -rf /', '../1.2.3', 'v1.2.3+x y']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('vergleicht numerisch, nicht als Text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.1.0')).toBeLessThan(0);
  });

  it('stuft Vorabversionen unter die fertige Version', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });
});

describe('updateInstallInput', () => {
  it('verlangt die ausdrückliche Bestätigung', () => {
    expect(updateInstallInput.safeParse({ version: '1.0.0' }).success).toBe(false);
    expect(updateInstallInput.safeParse({ version: '1.0.0', acknowledged: false }).success).toBe(
      false,
    );
    expect(updateInstallInput.safeParse({ version: '1.0.0', acknowledged: true }).success).toBe(
      true,
    );
  });
});

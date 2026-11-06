import { isRandomMac, macPrefix } from '@ultimate-dash/shared';
import oui from './oui.json' with { type: 'json' };

const table = oui as Record<string, string>;

/** Hersteller zu einer Herstellerkennung (6 Hexstellen) aus der mitgelieferten IEEE-Liste. */
export function vendorOfPrefix(prefix: string): string | null {
  return table[prefix.toUpperCase()] ?? null;
}

export function vendorOfMac(mac: string): { vendor: string | null; random: boolean } {
  const prefix = macPrefix(mac);
  if (!prefix || isRandomMac(mac)) return { vendor: null, random: !!prefix };
  return { vendor: vendorOfPrefix(prefix), random: false };
}

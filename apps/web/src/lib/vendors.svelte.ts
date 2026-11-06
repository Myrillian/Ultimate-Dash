import { isRandomMac, macPrefix } from '@ultimate-dash/shared';
import { api } from './api';

/**
 * Hersteller zu MAC-Adressen. Der Server liefert sie aus der mitgelieferten IEEE-Liste,
 * hier werden sie gesammelt abgefragt und gemerkt. Zufällige („private“) MACs haben keinen
 * Hersteller und werden gekennzeichnet.
 */
class VendorStore {
  /** Herstellerkennung → Name; null = nicht in der Liste */
  names = $state<Record<string, string | null>>({});
  private asked = new Set<string>();

  /** Fehlende Herstellerkennungen aus den MACs nachladen. */
  async ensure(macs: Iterable<string | null | undefined>): Promise<void> {
    const missing = new Set<string>();
    for (const mac of macs) {
      if (!mac || isRandomMac(mac)) continue;
      const prefix = macPrefix(mac);
      if (prefix && !this.asked.has(prefix)) missing.add(prefix);
    }
    if (missing.size === 0) return;
    for (const prefix of missing) this.asked.add(prefix);
    try {
      const found = await api.ipamVendors([...missing]);
      this.names = { ...this.names, ...found };
    } catch {
      // Beim nächsten Mal erneut versuchen.
      for (const prefix of missing) this.asked.delete(prefix);
    }
  }

  /** Anzeigetext zur MAC: Hersteller, „Zufällige MAC“ oder leer, solange er noch geladen wird. */
  label(mac: string | null | undefined): string {
    if (!mac) return '';
    if (isRandomMac(mac)) return 'Zufällige MAC';
    const prefix = macPrefix(mac);
    if (!prefix) return '';
    const name = this.names[prefix];
    return name === undefined ? '' : (name ?? 'Unbekannter Hersteller');
  }
}

export const vendors = new VendorStore();

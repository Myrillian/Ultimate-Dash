import { and, eq, gte, lt } from 'drizzle-orm';
import type { IpamHistory, IpamUsage } from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import { ipamNetworkHistory } from '../db/schema.js';

/** So viele Tage bleiben gespeichert; angezeigt werden höchstens so viele. */
export const HISTORY_KEEP_DAYS = 90;

/** Tag in Serverzeit als JJJJ-MM-TT. */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Verlauf der Belegung je Netz: ein Eintrag pro Tag. „Vergeben“ ist der letzte Stand des Tages,
 * „online“ der Höchstwert, damit nachts ausgeschaltete Geräte den Tageswert nicht drücken.
 */
export class IpamHistoryStore {
  constructor(private readonly db: Db) {}

  /** Übernimmt eine berechnete Belegung als Wert für den Tag. */
  record(usage: IpamUsage, now = new Date()): void {
    if (!usage.available) return;
    const day = localDay(now);
    this.db.transaction((tx) => {
      for (const u of Object.values(usage.networks)) {
        const online = u.stats.scanned ? u.stats.online : null;
        const existing = tx
          .select()
          .from(ipamNetworkHistory)
          .where(
            and(eq(ipamNetworkHistory.networkId, u.networkId), eq(ipamNetworkHistory.day, day)),
          )
          .get();
        if (existing) {
          tx.update(ipamNetworkHistory)
            .set({
              total: u.stats.total,
              used: u.stats.used,
              online:
                online === null ? existing.online : Math.max(online, existing.online ?? online),
            })
            .where(eq(ipamNetworkHistory.id, existing.id))
            .run();
        } else {
          tx.insert(ipamNetworkHistory)
            .values({
              networkId: u.networkId,
              day,
              total: u.stats.total,
              used: u.stats.used,
              online,
            })
            .run();
        }
      }
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
      tx.delete(ipamNetworkHistory)
        .where(lt(ipamNetworkHistory.day, localDay(cutoff)))
        .run();
    });
  }

  /** Tageswerte der letzten `days` Tage je Netz, älteste zuerst. */
  series(days: number, now = new Date()): IpamHistory {
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    const rows = this.db
      .select()
      .from(ipamNetworkHistory)
      .where(gte(ipamNetworkHistory.day, localDay(from)))
      .orderBy(ipamNetworkHistory.day)
      .all();
    const result: IpamHistory = {};
    for (const row of rows)
      (result[row.networkId] ??= []).push({
        day: row.day,
        total: row.total,
        used: row.used,
        online: row.online,
      });
    return result;
  }
}

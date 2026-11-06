import { desc, lt, sql } from 'drizzle-orm';
import type { AuditEntry, User } from '@ultimate-dash/shared';
import type { Db } from './client.js';
import { auditLog } from './schema.js';

/** Einträge älter als ein Jahr werden beim Schreiben gelegentlich entfernt. */
const RETENTION_DAYS = 365;

export function createAuditLog(db: Db) {
  let writes = 0;

  return {
    record(entry: {
      user: Pick<User, 'id' | 'username'> | null;
      action: string;
      target?: string | null;
      details?: Record<string, unknown>;
      ok: boolean;
      error?: string | null;
    }) {
      db.insert(auditLog)
        .values({
          userId: entry.user?.id ?? null,
          username: entry.user?.username ?? null,
          action: entry.action,
          target: entry.target ?? null,
          details: entry.details ?? null,
          ok: entry.ok,
          error: entry.error ?? null,
        })
        .run();
      if (++writes % 100 === 1) {
        db.delete(auditLog)
          .where(
            lt(
              auditLog.at,
              sql`strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`-${RETENTION_DAYS} days`})`,
            ),
          )
          .run();
      }
    },

    list(limit = 100): AuditEntry[] {
      return db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(limit)
        .all()
        .map((row) => ({
          id: row.id,
          at: row.at,
          username: row.username,
          action: row.action,
          target: row.target,
          ok: row.ok,
          error: row.error,
        }));
    },
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;

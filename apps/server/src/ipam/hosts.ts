import { eq } from 'drizzle-orm';
import { ipamHostUpdate, type IpamHostUpdate, type User } from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { NotFoundError } from '../db/repository.js';
import { ipamHosts } from '../db/schema.js';

export type HostRow = typeof ipamHosts.$inferSelect;

/** Per Ping gefundene Geräte samt Erreichbarkeit. Der Scanner schreibt, Admins bestätigen oder vergessen. */
export class IpamHostStore {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
  ) {}

  all(): HostRow[] {
    return this.db.select().from(ipamHosts).all();
  }

  /** Übernimmt das Ergebnis eines Durchlaufs über ein Netz in einer Transaktion. */
  record(results: { address: string; alive: boolean }[], at: string) {
    this.db.transaction((tx) => {
      const existing = new Map(
        tx
          .select()
          .from(ipamHosts)
          .all()
          .map((r) => [r.address, r]),
      );
      for (const { address, alive } of results) {
        const row = existing.get(address);
        if (row) {
          tx.update(ipamHosts)
            .set({ alive, lastCheckedAt: at, ...(alive ? { lastSeenAt: at } : {}) })
            .where(eq(ipamHosts.id, row.id))
            .run();
        } else if (alive) {
          tx.insert(ipamHosts)
            .values({ address, alive: true, firstSeenAt: at, lastSeenAt: at, lastCheckedAt: at })
            .run();
        }
      }
    });
  }

  update(id: number, raw: IpamHostUpdate, user: User) {
    const row = this.require(id);
    const input = ipamHostUpdate.parse(raw);
    this.db.update(ipamHosts).set(input).where(eq(ipamHosts.id, id)).run();
    this.audit.record({
      user,
      action: input.acknowledged ? 'ipam.host.acknowledge' : 'ipam.host.update',
      target: row.address,
      details: { name: input.name },
      ok: true,
    });
  }

  /** Vergisst das Gerät; antwortet es beim nächsten Durchlauf wieder, wird es erneut als entdeckt gelistet. */
  delete(id: number, user: User) {
    const row = this.require(id);
    this.db.delete(ipamHosts).where(eq(ipamHosts.id, id)).run();
    this.audit.record({ user, action: 'ipam.host.forget', target: row.address, ok: true });
  }

  private require(id: number): HostRow {
    const row = this.db.select().from(ipamHosts).where(eq(ipamHosts.id, id)).get();
    if (!row) throw new NotFoundError('Gerät');
    return row;
  }
}

import { asc, eq, max } from 'drizzle-orm';
import {
  cidrsOverlap,
  ipamCategoryInput,
  ipamNetworkInput,
  ipamRangeInput,
  ipv4ToInt,
  parseCidr,
  validateRange,
  type IpamCategory,
  type IpamCategoryInput,
  type IpamData,
  type IpamNetwork,
  type IpamNetworkInput,
  type IpamRange,
  type IpamRangeInput,
  type User,
  type CategoryColor,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { NotFoundError, ValidationError } from '../db/repository.js';
import { ipamCategories, ipamNetworks, ipamRanges } from '../db/schema.js';

const toNetwork = (row: typeof ipamNetworks.$inferSelect): IpamNetwork => ({
  id: row.id,
  name: row.name,
  cidr: row.cidr,
  vlanId: row.vlanId,
  gateway: row.gateway,
  description: row.description,
});

const toCategory = (row: typeof ipamCategories.$inferSelect): IpamCategory => ({
  id: row.id,
  name: row.name,
  color: row.color as CategoryColor,
  description: row.description,
});

const toRange = (row: typeof ipamRanges.$inferSelect): IpamRange => ({
  id: row.id,
  networkId: row.networkId,
  categoryId: row.categoryId,
  startAddress: row.startAddress,
  endAddress: row.endAddress,
  label: row.label,
});

/** Netze, Kategorien und IP-Bereiche in der eigenen Datenbank. Änderungen landen im Audit-Log. */
export class IpamRepository {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
  ) {}

  all(): IpamData {
    return {
      networks: this.db
        .select()
        .from(ipamNetworks)
        .orderBy(asc(ipamNetworks.sortOrder), asc(ipamNetworks.id))
        .all()
        .map(toNetwork)
        .sort((a, b) => parseCidr(a.cidr)!.first - parseCidr(b.cidr)!.first),
      categories: this.db
        .select()
        .from(ipamCategories)
        .orderBy(asc(ipamCategories.sortOrder), asc(ipamCategories.id))
        .all()
        .map(toCategory),
      ranges: this.db
        .select()
        .from(ipamRanges)
        .all()
        .map(toRange)
        .sort((a, b) => ipv4ToInt(a.startAddress)! - ipv4ToInt(b.startAddress)!),
    };
  }

  private log(user: User, action: string, target: string, details: Record<string, unknown> = {}) {
    this.audit.record({ user, action: `ipam.${action}`, target, details, ok: true });
  }

  private network(id: number) {
    const row = this.db.select().from(ipamNetworks).where(eq(ipamNetworks.id, id)).get();
    if (!row) throw new NotFoundError('Netz');
    return row;
  }

  private category(id: number) {
    const row = this.db.select().from(ipamCategories).where(eq(ipamCategories.id, id)).get();
    if (!row) throw new NotFoundError('Kategorie');
    return row;
  }

  private checkNetwork(input: ReturnType<typeof ipamNetworkInput.parse>, selfId: number | null) {
    const cidr = parseCidr(input.cidr)!;
    const others = this.db
      .select()
      .from(ipamNetworks)
      .all()
      .filter((n) => n.id !== selfId);
    const clash = others.find((n) => cidrsOverlap(cidr, parseCidr(n.cidr)!));
    if (clash) throw new ValidationError(`Überschneidet sich mit „${clash.name}“ (${clash.cidr})`);
    if (input.gateway) {
      const gw = ipv4ToInt(input.gateway)!;
      if (gw <= cidr.first || gw >= cidr.last)
        throw new ValidationError('Das Gateway liegt nicht im Netz');
    }
    if (selfId !== null) {
      const outside = this.db
        .select()
        .from(ipamRanges)
        .where(eq(ipamRanges.networkId, selfId))
        .all()
        .find(
          (r) => ipv4ToInt(r.startAddress)! < cidr.first || ipv4ToInt(r.endAddress)! > cidr.last,
        );
      if (outside)
        throw new ValidationError(
          `Der Bereich ${outside.startAddress} – ${outside.endAddress} läge dann außerhalb des Netzes`,
        );
    }
  }

  createNetwork(raw: IpamNetworkInput, user: User): IpamNetwork {
    const input = ipamNetworkInput.parse(raw);
    this.checkNetwork(input, null);
    const order =
      (this.db
        .select({ v: max(ipamNetworks.sortOrder) })
        .from(ipamNetworks)
        .get()?.v ?? -1) + 1;
    const row = this.db
      .insert(ipamNetworks)
      .values({ ...input, cidr: input.cidr.trim(), sortOrder: order })
      .returning()
      .get();
    this.log(user, 'network.create', `${row.name} ${row.cidr}`);
    return toNetwork(row);
  }

  updateNetwork(id: number, raw: IpamNetworkInput, user: User): IpamNetwork {
    this.network(id);
    const input = ipamNetworkInput.parse(raw);
    this.checkNetwork(input, id);
    const row = this.db
      .update(ipamNetworks)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(ipamNetworks.id, id))
      .returning()
      .get();
    this.log(user, 'network.update', `${row.name} ${row.cidr}`);
    return toNetwork(row);
  }

  deleteNetwork(id: number, user: User) {
    const row = this.network(id);
    this.db.delete(ipamNetworks).where(eq(ipamNetworks.id, id)).run();
    this.log(user, 'network.delete', `${row.name} ${row.cidr}`);
  }

  createCategory(raw: IpamCategoryInput, user: User): IpamCategory {
    const input = ipamCategoryInput.parse(raw);
    this.checkCategoryName(input.name, null);
    const order =
      (this.db
        .select({ v: max(ipamCategories.sortOrder) })
        .from(ipamCategories)
        .get()?.v ?? -1) + 1;
    const row = this.db
      .insert(ipamCategories)
      .values({ ...input, sortOrder: order })
      .returning()
      .get();
    this.log(user, 'category.create', row.name);
    return toCategory(row);
  }

  updateCategory(id: number, raw: IpamCategoryInput, user: User): IpamCategory {
    this.category(id);
    const input = ipamCategoryInput.parse(raw);
    this.checkCategoryName(input.name, id);
    const row = this.db
      .update(ipamCategories)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(ipamCategories.id, id))
      .returning()
      .get();
    this.log(user, 'category.update', row.name);
    return toCategory(row);
  }

  /** Entfernt auch alle Bereiche der Kategorie. */
  deleteCategory(id: number, user: User) {
    const row = this.category(id);
    this.db.delete(ipamCategories).where(eq(ipamCategories.id, id)).run();
    this.log(user, 'category.delete', row.name);
  }

  private checkCategoryName(name: string, selfId: number | null) {
    const clash = this.db
      .select()
      .from(ipamCategories)
      .all()
      .find((c) => c.id !== selfId && c.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new ValidationError(`Die Kategorie „${name}“ gibt es schon`);
  }

  private checkRange(input: ReturnType<typeof ipamRangeInput.parse>, selfId: number | null) {
    const network = this.network(input.networkId);
    this.category(input.categoryId);
    const others = this.db
      .select()
      .from(ipamRanges)
      .where(eq(ipamRanges.networkId, input.networkId))
      .all()
      .filter((r) => r.id !== selfId);
    const problem = validateRange(network.cidr, others, input);
    if (problem) throw new ValidationError(problem);
    return network;
  }

  createRange(raw: IpamRangeInput, user: User): IpamRange {
    const input = ipamRangeInput.parse(raw);
    const network = this.checkRange(input, null);
    const row = this.db.insert(ipamRanges).values(input).returning().get();
    this.log(user, 'range.create', `${row.startAddress} – ${row.endAddress}`, {
      network: network.name,
    });
    return toRange(row);
  }

  updateRange(id: number, raw: IpamRangeInput, user: User): IpamRange {
    const existing = this.db.select().from(ipamRanges).where(eq(ipamRanges.id, id)).get();
    if (!existing) throw new NotFoundError('Bereich');
    const input = ipamRangeInput.parse(raw);
    const network = this.checkRange(input, id);
    const row = this.db
      .update(ipamRanges)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(eq(ipamRanges.id, id))
      .returning()
      .get();
    this.log(user, 'range.update', `${row.startAddress} – ${row.endAddress}`, {
      network: network.name,
    });
    return toRange(row);
  }

  deleteRange(id: number, user: User) {
    const row = this.db.select().from(ipamRanges).where(eq(ipamRanges.id, id)).get();
    if (!row) throw new NotFoundError('Bereich');
    this.db.delete(ipamRanges).where(eq(ipamRanges.id, id)).run();
    this.log(user, 'range.delete', `${row.startAddress} – ${row.endAddress}`);
  }
}

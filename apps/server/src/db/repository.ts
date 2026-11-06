import { and, asc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import type {
  ConfigFile,
  CopyDashboardInput,
  CopySummary,
  DashboardSource,
  DashboardData,
  ImportMode,
  ImportSummary,
  ParsedConfigFile,
  Group,
  GroupInput,
  Service,
  ServiceInput,
} from '@ultimate-dash/shared';
import { groupInput, serviceInput } from '@ultimate-dash/shared';
import type { Db } from './client.js';
import { groups, services, settings, users } from './schema.js';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} nicht gefunden`);
  }
}

type GroupRow = typeof groups.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

const toGroup = (row: GroupRow): Group => ({
  id: row.id,
  name: row.name,
  icon: row.icon,
  collapsed: row.collapsed,
  sortOrder: row.sortOrder,
});

const toService = (row: ServiceRow): Service => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  url: row.url,
  description: row.description,
  icon: row.icon,
  target: row.target,
  statusCheck: row.statusCheck,
  statusUrl: row.statusUrl,
  tags: row.tags,
  sortOrder: row.sortOrder,
});

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function createRepository(db: Db) {
  const nextGroupOrder = (userId: number) =>
    (db
      .select({ value: max(groups.sortOrder) })
      .from(groups)
      .where(eq(groups.userId, userId))
      .get()?.value ?? -1) + 1;

  const nextServiceOrder = (groupId: number) =>
    (db
      .select({ value: max(services.sortOrder) })
      .from(services)
      .where(eq(services.groupId, groupId))
      .get()?.value ?? -1) + 1;

  /** Gruppe nur finden, wenn sie dem Benutzer gehört – fremde Gruppen sind „nicht gefunden“. */
  const requireGroup = (userId: number, id: number) => {
    const row = db
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), eq(groups.userId, userId)))
      .get();
    if (!row) throw new NotFoundError('Gruppe');
    return row;
  };

  const titleKey = (userId: number) => `title:${userId}`;

  /**
   * Altbestand ohne Besitzer (Dashboard stammt aus der Zeit vor den Benutzern und es gab bei der
   * Migration noch keinen Admin) gehört dem ältesten Admin.
   */
  const adoptOrphans = (userId: number) => {
    const orphans = db.select({ id: groups.id }).from(groups).where(isNull(groups.userId)).get();
    if (!orphans) return;
    const firstAdmin = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'))
      .orderBy(asc(users.id))
      .get();
    if (firstAdmin?.id !== userId) return;
    db.transaction((tx) => {
      tx.update(groups).set({ userId }).where(isNull(groups.userId)).run();
      const legacy = tx.select().from(settings).where(eq(settings.key, 'title')).get();
      if (legacy) {
        tx.insert(settings)
          .values({ key: titleKey(userId), value: legacy.value })
          .onConflictDoNothing()
          .run();
      }
    });
  };

  return {
    getTitle(userId: number): string {
      const row = db
        .select()
        .from(settings)
        .where(eq(settings.key, titleKey(userId)))
        .get();
      return typeof row?.value === 'string' ? row.value : 'Ultimate Dash';
    },

    getDashboard(userId: number): DashboardData {
      adoptOrphans(userId);
      const groupRows = db
        .select()
        .from(groups)
        .where(eq(groups.userId, userId))
        .orderBy(asc(groups.sortOrder), asc(groups.id))
        .all();
      const serviceRows = db
        .select({ service: services })
        .from(services)
        .innerJoin(groups, eq(services.groupId, groups.id))
        .where(eq(groups.userId, userId))
        .orderBy(asc(services.sortOrder), asc(services.id))
        .all()
        .map((row) => row.service);
      const byGroup = new Map<number, Service[]>();
      for (const row of serviceRows) {
        const list = byGroup.get(row.groupId) ?? [];
        list.push(toService(row));
        byGroup.set(row.groupId, list);
      }
      return {
        title: this.getTitle(userId),
        groups: groupRows.map((row) => ({ ...toGroup(row), services: byGroup.get(row.id) ?? [] })),
      };
    },

    /** Alle Services aller Benutzer (für die Statusprüfung). */
    listAllServices(): Service[] {
      return db.select().from(services).all().map(toService);
    },

    listServices(userId: number): Service[] {
      return db
        .select({ service: services })
        .from(services)
        .innerJoin(groups, eq(services.groupId, groups.id))
        .where(eq(groups.userId, userId))
        .all()
        .map((row) => toService(row.service));
    },

    getService(userId: number, id: number): Service {
      const row = db
        .select({ service: services })
        .from(services)
        .innerJoin(groups, eq(services.groupId, groups.id))
        .where(and(eq(services.id, id), eq(groups.userId, userId)))
        .get()?.service;
      if (!row) throw new NotFoundError('Service');
      return toService(row);
    },

    createGroup(userId: number, input: GroupInput): Group {
      const data = groupInput.parse(input);
      const row = db
        .insert(groups)
        .values({ ...data, userId, sortOrder: nextGroupOrder(userId) })
        .returning()
        .get();
      return toGroup(row);
    },

    updateGroup(userId: number, id: number, input: GroupInput): Group {
      requireGroup(userId, id);
      const data = groupInput.parse(input);
      const row = db
        .update(groups)
        .set({ ...data, updatedAt: now })
        .where(eq(groups.id, id))
        .returning()
        .get();
      return toGroup(row!);
    },

    deleteGroup(userId: number, id: number): void {
      requireGroup(userId, id);
      db.delete(groups).where(eq(groups.id, id)).run();
    },

    reorderGroups(userId: number, ids: number[]): void {
      db.transaction((tx) => {
        const existing = tx
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.userId, userId))
          .all();
        assertSameIds(
          existing.map((row) => row.id),
          ids,
        );
        ids.forEach((id, index) => {
          tx.update(groups).set({ sortOrder: index }).where(eq(groups.id, id)).run();
        });
      });
    },

    createService(userId: number, input: ServiceInput): Service {
      const data = serviceInput.parse(input);
      requireGroup(userId, data.groupId);
      const row = db
        .insert(services)
        .values({ ...data, sortOrder: nextServiceOrder(data.groupId) })
        .returning()
        .get();
      return toService(row);
    },

    updateService(userId: number, id: number, input: ServiceInput): Service {
      const current = this.getService(userId, id);
      const data = serviceInput.parse(input);
      requireGroup(userId, data.groupId);
      const movedGroup = data.groupId !== current.groupId;
      const row = db
        .update(services)
        .set({
          ...data,
          ...(movedGroup ? { sortOrder: nextServiceOrder(data.groupId) } : {}),
          updatedAt: now,
        })
        .where(eq(services.id, id))
        .returning()
        .get();
      return toService(row!);
    },

    deleteService(userId: number, id: number): void {
      this.getService(userId, id);
      db.delete(services).where(eq(services.id, id)).run();
    },

    /** Aktueller Stand als YAML-taugliches Objekt; Standardwerte werden weggelassen. */
    exportConfig(userId: number): ConfigFile {
      const dashboard = this.getDashboard(userId);
      return {
        version: 1,
        title: dashboard.title,
        groups: dashboard.groups.map((g) => ({
          name: g.name,
          ...(g.icon ? { icon: g.icon } : {}),
          ...(g.collapsed ? { collapsed: true } : {}),
          services: g.services.map((s) => ({
            name: s.name,
            url: s.url,
            ...(s.description ? { description: s.description } : {}),
            ...(s.icon ? { icon: s.icon } : {}),
            ...(s.target !== '_blank' ? { target: s.target } : {}),
            ...(!s.statusCheck ? { statusCheck: false } : {}),
            ...(s.statusUrl ? { statusUrl: s.statusUrl } : {}),
            ...(s.tags.length > 0 ? { tags: s.tags } : {}),
          })),
        })),
      };
    },

    /**
     * Übernimmt eine Konfigurationsdatei in einer Transaktion.
     * replace: alles ersetzen. merge: Gruppen per Name, Services per Name innerhalb der Gruppe
     * abgleichen (ohne Groß-/Kleinschreibung), Unbekanntes anhängen, nichts löschen.
     */
    importConfig(
      userId: number,
      file: ParsedConfigFile,
      mode: ImportMode,
      dryRun = false,
    ): ImportSummary {
      adoptOrphans(userId);
      const summary: ImportSummary = {
        groupsCreated: 0,
        groupsUpdated: 0,
        servicesCreated: 0,
        servicesUpdated: 0,
        groupsRemoved: 0,
        servicesRemoved: 0,
        titleChanged: false,
      };
      const key = (value: string) => value.trim().toLocaleLowerCase('de');
      try {
        db.transaction((tx) => {
          if (file.title !== undefined && file.title !== this.getTitle(userId)) {
            summary.titleChanged = true;
            tx.insert(settings)
              .values({ key: titleKey(userId), value: file.title })
              .onConflictDoUpdate({ target: settings.key, set: { value: file.title } })
              .run();
          }
          if (mode === 'replace') {
            const own = tx
              .select({ id: groups.id })
              .from(groups)
              .where(eq(groups.userId, userId))
              .all()
              .map((row) => row.id);
            summary.groupsRemoved = own.length;
            if (own.length > 0) {
              summary.servicesRemoved = tx
                .select({ id: services.id })
                .from(services)
                .where(inArray(services.groupId, own))
                .all().length;
              tx.delete(groups).where(inArray(groups.id, own)).run();
            }
          }
          const existingGroups = new Map(
            tx
              .select()
              .from(groups)
              .where(eq(groups.userId, userId))
              .all()
              .map((row) => [key(row.name), row]),
          );
          let groupOrder = nextGroupOrder(userId);

          for (const entry of file.groups) {
            const { services: entries, ...groupData } = entry;
            let groupRow = existingGroups.get(key(groupData.name));
            if (groupRow) {
              tx.update(groups)
                .set({ ...groupData, updatedAt: now })
                .where(eq(groups.id, groupRow.id))
                .run();
              summary.groupsUpdated++;
            } else {
              groupRow = tx
                .insert(groups)
                .values({ ...groupData, userId, sortOrder: groupOrder++ })
                .returning()
                .get();
              existingGroups.set(key(groupData.name), groupRow);
              summary.groupsCreated++;
            }

            const groupId = groupRow.id;
            const existingServices = new Map(
              tx
                .select()
                .from(services)
                .where(eq(services.groupId, groupId))
                .all()
                .map((row) => [key(row.name), row]),
            );
            let serviceOrder =
              (tx
                .select({ value: max(services.sortOrder) })
                .from(services)
                .where(eq(services.groupId, groupId))
                .get()?.value ?? -1) + 1;
            for (const serviceData of entries) {
              const current = existingServices.get(key(serviceData.name));
              if (current) {
                tx.update(services)
                  .set({ ...serviceData, updatedAt: now })
                  .where(eq(services.id, current.id))
                  .run();
                summary.servicesUpdated++;
              } else {
                const row = tx
                  .insert(services)
                  .values({ ...serviceData, groupId, sortOrder: serviceOrder++ })
                  .returning()
                  .get();
                existingServices.set(key(serviceData.name), row);
                summary.servicesCreated++;
              }
            }
          }
          if (dryRun) throw new DryRun();
        });
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
      }
      return summary;
    },

    /** Dashboards der anderen Benutzer als Vorlage zum Kopieren (nur Benutzer mit Inhalt). */
    listSources(userId: number): DashboardSource[] {
      const owners = db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(ne(users.id, userId))
        .orderBy(asc(users.username))
        .all();
      const result: DashboardSource[] = [];
      for (const owner of owners) {
        const dashboard = this.getDashboard(owner.id);
        if (dashboard.groups.length === 0) continue;
        result.push({
          userId: owner.id,
          username: owner.username,
          groups: dashboard.groups.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            services: g.services.map((s) => ({
              id: s.id,
              name: s.name,
              url: s.url,
              icon: s.icon,
            })),
          })),
        });
      }
      return result;
    },

    /**
     * Kopiert ausgewählte Gruppen/Services eines anderen Benutzers in das eigene Dashboard.
     * Unabhängige Kopien; Gruppen gleichen Namens werden ergänzt, gleichnamige Services übersprungen.
     */
    copyFrom(userId: number, input: CopyDashboardInput): CopySummary {
      const summary: CopySummary = {
        groupsCreated: 0,
        groupsExtended: 0,
        servicesCreated: 0,
        servicesSkipped: 0,
      };
      if (input.sourceUserId === userId) {
        throw new ValidationError('Das eigene Dashboard kann nicht in sich selbst kopiert werden');
      }
      const key = (value: string) => value.trim().toLocaleLowerCase('de');
      db.transaction((tx) => {
        const own = new Map(
          tx
            .select()
            .from(groups)
            .where(eq(groups.userId, userId))
            .all()
            .map((row) => [key(row.name), row]),
        );
        let groupOrder = nextGroupOrder(userId);
        for (const pick of input.groups) {
          const source = tx
            .select()
            .from(groups)
            .where(and(eq(groups.id, pick.groupId), eq(groups.userId, input.sourceUserId)))
            .get();
          if (!source) throw new NotFoundError('Gruppe');
          let target = own.get(key(source.name));
          if (target) {
            summary.groupsExtended++;
          } else {
            target = tx
              .insert(groups)
              .values({
                userId,
                name: source.name,
                icon: source.icon,
                collapsed: source.collapsed,
                sortOrder: groupOrder++,
              })
              .returning()
              .get();
            own.set(key(source.name), target);
            summary.groupsCreated++;
          }
          const ids = [...new Set(pick.serviceIds)];
          const picked =
            ids.length === 0
              ? []
              : tx
                  .select()
                  .from(services)
                  .where(and(inArray(services.id, ids), eq(services.groupId, source.id)))
                  .orderBy(asc(services.sortOrder), asc(services.id))
                  .all();
          if (picked.length !== ids.length) throw new NotFoundError('Service');
          const names = new Set(
            tx
              .select({ name: services.name })
              .from(services)
              .where(eq(services.groupId, target.id))
              .all()
              .map((row) => key(row.name)),
          );
          let serviceOrder = nextServiceOrder(target.id);
          for (const row of picked) {
            if (names.has(key(row.name))) {
              summary.servicesSkipped++;
              continue;
            }
            tx.insert(services)
              .values({
                groupId: target.id,
                name: row.name,
                url: row.url,
                description: row.description,
                icon: row.icon,
                target: row.target,
                statusCheck: row.statusCheck,
                statusUrl: row.statusUrl,
                tags: row.tags,
                sortOrder: serviceOrder++,
              })
              .run();
            names.add(key(row.name));
            summary.servicesCreated++;
          }
        }
      });
      return summary;
    },

    /** Setzt Reihenfolge (und ggf. Gruppe) der übergebenen Services. */
    arrangeServices(userId: number, groupId: number, ids: number[]): void {
      db.transaction((tx) => {
        const target = tx
          .select()
          .from(groups)
          .where(and(eq(groups.id, groupId), eq(groups.userId, userId)))
          .get();
        if (!target) throw new NotFoundError('Gruppe');
        const found = tx
          .select({ id: services.id })
          .from(services)
          .innerJoin(groups, eq(services.groupId, groups.id))
          .where(and(inArray(services.id, ids), eq(groups.userId, userId)))
          .all();
        if (found.length !== new Set(ids).size) throw new NotFoundError('Service');
        ids.forEach((id, index) => {
          tx.update(services).set({ groupId, sortOrder: index }).where(eq(services.id, id)).run();
        });
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

export class ValidationError extends Error {}

/** Bricht die Transaktion bei einer Probe ab, damit nichts gespeichert wird. */
class DryRun extends Error {}

function assertSameIds(existing: number[], given: number[]) {
  const a = [...existing].sort((x, y) => x - y);
  const b = [...given].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((value, index) => value !== b[index])) {
    throw new ValidationError('Die Liste muss jede vorhandene ID genau einmal enthalten');
  }
}

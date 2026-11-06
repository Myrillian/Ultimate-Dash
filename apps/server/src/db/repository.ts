import { asc, eq, inArray, max, sql } from 'drizzle-orm';
import type {
  ConfigFile,
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
import { groups, services, settings } from './schema.js';

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
  const nextGroupOrder = () =>
    (db
      .select({ value: max(groups.sortOrder) })
      .from(groups)
      .get()?.value ?? -1) + 1;

  const nextServiceOrder = (groupId: number) =>
    (db
      .select({ value: max(services.sortOrder) })
      .from(services)
      .where(eq(services.groupId, groupId))
      .get()?.value ?? -1) + 1;

  const requireGroup = (id: number) => {
    const row = db.select().from(groups).where(eq(groups.id, id)).get();
    if (!row) throw new NotFoundError('Gruppe');
    return row;
  };

  return {
    getTitle(): string {
      const row = db.select().from(settings).where(eq(settings.key, 'title')).get();
      return typeof row?.value === 'string' ? row.value : 'Ultimate Dash';
    },

    getDashboard(): DashboardData {
      const groupRows = db
        .select()
        .from(groups)
        .orderBy(asc(groups.sortOrder), asc(groups.id))
        .all();
      const serviceRows = db
        .select()
        .from(services)
        .orderBy(asc(services.sortOrder), asc(services.id))
        .all();
      const byGroup = new Map<number, Service[]>();
      for (const row of serviceRows) {
        const list = byGroup.get(row.groupId) ?? [];
        list.push(toService(row));
        byGroup.set(row.groupId, list);
      }
      return {
        title: this.getTitle(),
        groups: groupRows.map((row) => ({ ...toGroup(row), services: byGroup.get(row.id) ?? [] })),
      };
    },

    listServices(): Service[] {
      return db.select().from(services).all().map(toService);
    },

    getService(id: number): Service {
      const row = db.select().from(services).where(eq(services.id, id)).get();
      if (!row) throw new NotFoundError('Service');
      return toService(row);
    },

    createGroup(input: GroupInput): Group {
      const data = groupInput.parse(input);
      const row = db
        .insert(groups)
        .values({ ...data, sortOrder: nextGroupOrder() })
        .returning()
        .get();
      return toGroup(row);
    },

    updateGroup(id: number, input: GroupInput): Group {
      requireGroup(id);
      const data = groupInput.parse(input);
      const row = db
        .update(groups)
        .set({ ...data, updatedAt: now })
        .where(eq(groups.id, id))
        .returning()
        .get();
      return toGroup(row!);
    },

    deleteGroup(id: number): void {
      requireGroup(id);
      db.delete(groups).where(eq(groups.id, id)).run();
    },

    reorderGroups(ids: number[]): void {
      db.transaction((tx) => {
        const existing = tx.select({ id: groups.id }).from(groups).all();
        assertSameIds(
          existing.map((row) => row.id),
          ids,
        );
        ids.forEach((id, index) => {
          tx.update(groups).set({ sortOrder: index }).where(eq(groups.id, id)).run();
        });
      });
    },

    createService(input: ServiceInput): Service {
      const data = serviceInput.parse(input);
      requireGroup(data.groupId);
      const row = db
        .insert(services)
        .values({ ...data, sortOrder: nextServiceOrder(data.groupId) })
        .returning()
        .get();
      return toService(row);
    },

    updateService(id: number, input: ServiceInput): Service {
      const current = this.getService(id);
      const data = serviceInput.parse(input);
      requireGroup(data.groupId);
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

    deleteService(id: number): void {
      this.getService(id);
      db.delete(services).where(eq(services.id, id)).run();
    },

    /** Aktueller Stand als YAML-taugliches Objekt; Standardwerte werden weggelassen. */
    exportConfig(): ConfigFile {
      const dashboard = this.getDashboard();
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
    importConfig(file: ParsedConfigFile, mode: ImportMode, dryRun = false): ImportSummary {
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
          if (file.title !== undefined && file.title !== this.getTitle()) {
            summary.titleChanged = true;
            tx.insert(settings)
              .values({ key: 'title', value: file.title })
              .onConflictDoUpdate({ target: settings.key, set: { value: file.title } })
              .run();
          }
          if (mode === 'replace') {
            summary.groupsRemoved = tx.select({ id: groups.id }).from(groups).all().length;
            summary.servicesRemoved = tx.select({ id: services.id }).from(services).all().length;
            tx.delete(services).run();
            tx.delete(groups).run();
          }
          const existingGroups = new Map(
            tx
              .select()
              .from(groups)
              .all()
              .map((row) => [key(row.name), row]),
          );
          let groupOrder =
            (tx
              .select({ value: max(groups.sortOrder) })
              .from(groups)
              .get()?.value ?? -1) + 1;

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
                .values({ ...groupData, sortOrder: groupOrder++ })
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

    /** Setzt Reihenfolge (und ggf. Gruppe) der übergebenen Services. */
    arrangeServices(groupId: number, ids: number[]): void {
      db.transaction((tx) => {
        const target = tx.select().from(groups).where(eq(groups.id, groupId)).get();
        if (!target) throw new NotFoundError('Gruppe');
        const found = tx
          .select({ id: services.id })
          .from(services)
          .where(inArray(services.id, ids))
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

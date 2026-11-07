import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type {
  DhcpLease,
  DhcpServer,
  DhcpServerInput,
  DhcpLeaseAction,
  DhcpReservation,
  DhcpReservationDelete,
  DhcpReservationInput,
  DhcpReservationUpdate,
  DhcpScope,
  DhcpScopeState,
  User,
} from '@ultimate-dash/shared';
import {
  MAIN_DHCP_SERVER,
  dhcpLeaseAction,
  dhcpReservationDelete,
  dhcpServerInput,
  dhcpReservationInput,
  dhcpReservationUpdate,
  dhcpScopeState,
} from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import { NotFoundError, ValidationError } from '../db/repository.js';
import { settings } from '../db/schema.js';
import { TechnitiumError, type TechnitiumConnection } from './client.js';
import type { Params } from './records.js';

const SERVERS_KEY = 'technitium.dhcpServers';

/** Was DhcpService vom Technitium-Dienst braucht. */
export interface TechnitiumApi {
  mainConnection(): TechnitiumConnection;
  callWith<T>(connection: TechnitiumConnection, path: string, params?: Params): Promise<T>;
  audited<T>(
    user: User,
    action: string,
    target: string,
    details: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T>;
}

interface RawScopeListEntry {
  name: string;
  enabled: boolean;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  networkAddress?: string;
}

interface RawScope {
  name: string;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  leaseTimeDays?: number;
  leaseTimeHours?: number;
  leaseTimeMinutes?: number;
  domainName?: string | null;
  routerAddress?: string | null;
  dnsServers?: string[] | null;
  exclusions?: { startingAddress: string; endingAddress: string }[] | null;
  reservedLeases?:
    | {
        hostName?: string | null;
        hardwareAddress: string;
        address: string;
        comments?: string | null;
      }[]
    | null;
  allowOnlyReservedLeases?: boolean;
}

/** Gespeicherter weiterer Server; token null = Token der Hauptverbindung verwenden. */
interface StoredServer {
  id: string;
  name: string;
  url: string;
  token: string | null;
  tlsInsecure: boolean;
}

interface Target {
  id: string;
  name: string;
  connection: TechnitiumConnection;
}

interface RawLease {
  scope: string;
  type: string;
  hardwareAddress: string;
  address: string;
  hostName?: string | null;
  leaseObtained?: string | null;
  leaseExpires?: string | null;
}

/** Technitium schreibt MACs mit Bindestrichen; wir vergleichen unabhängig von Schreibweise. */
const sameMac = (a: string, b: string) =>
  a.replace(/[:-]/g, '').toLowerCase() === b.replace(/[:-]/g, '').toLowerCase();

/**
 * Technitium schreibt Zeitpunkte als ISO mit 7 Nachkommastellen, die nicht jeder Browser parsen
 * kann; wir kürzen auf Millisekunden. Andere Formate (ältere Versionen) bleiben unverändert.
 */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m) return value;
  const fraction = m[2] ? `.${m[2].slice(0, 3).padEnd(3, '0')}` : '';
  return `${m[1]}${fraction}${m[3] ?? 'Z'}`;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const sameUrl = (a: string, b: string) =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

const toReservation = (raw: NonNullable<RawScope['reservedLeases']>[number]): DhcpReservation => ({
  hardwareAddress: raw.hardwareAddress,
  address: raw.address,
  hostName: raw.hostName || null,
  comments: raw.comments || null,
});

export class DhcpService {
  /** Fehler beim letzten Abruf je weiterem Server (Hauptserver-Fehler werden geworfen). */
  private errors = new Map<string, string>();

  constructor(
    private readonly api: TechnitiumApi,
    private readonly db: Db,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Weitere Server

  private stored(): StoredServer[] {
    const row = this.db.select().from(settings).where(eq(settings.key, SERVERS_KEY)).get();
    return Array.isArray(row?.value) ? (row.value as StoredServer[]) : [];
  }

  private store(list: StoredServer[]) {
    this.db
      .insert(settings)
      .values({ key: SERVERS_KEY, value: list })
      .onConflictDoUpdate({ target: settings.key, set: { value: list } })
      .run();
  }

  private mainTarget(): Target {
    const connection = this.api.mainConnection();
    return { id: MAIN_DHCP_SERVER, name: hostOf(connection.url), connection };
  }

  private resolve(server: StoredServer, main: TechnitiumConnection): Target {
    return {
      id: server.id,
      name: server.name,
      connection: {
        url: server.url,
        token: server.token ?? main.token,
        tlsInsecure: server.tlsInsecure,
      },
    };
  }

  /** Alle Server, deren DHCP ausgelesen wird; der Hauptserver zuerst. */
  private targets(): Target[] {
    const main = this.mainTarget();
    return [main, ...this.stored().map((s) => this.resolve(s, main.connection))];
  }

  private target(id: string): Target {
    const found = this.targets().find((t) => t.id === id);
    if (!found) throw new NotFoundError('DHCP-Server');
    return found;
  }

  /**
   * Fragt alle Server ab. Fällt der Hauptserver aus, schlägt der Abruf fehl wie bisher;
   * ein weiterer Server, der nicht antwortet, wird übersprungen und als Fehler vermerkt.
   */
  private async collect<T>(run: (target: Target) => Promise<T[]>): Promise<T[]> {
    const targets = this.targets();
    const results = await Promise.allSettled(targets.map(run));
    const out: T[] = [];
    results.forEach((result, i) => {
      const target = targets[i]!;
      if (result.status === 'fulfilled') {
        this.errors.delete(target.id);
        out.push(...result.value);
      } else if (target.id === MAIN_DHCP_SERVER) {
        throw result.reason;
      } else {
        const reason = result.reason as unknown;
        this.errors.set(target.id, reason instanceof Error ? reason.message : String(reason));
      }
    });
    return out;
  }

  listServers(): DhcpServer[] {
    let main: Target | null = null;
    try {
      main = this.mainTarget();
    } catch {
      // Ohne Hauptverbindung gibt es auch keine weiteren Server zu nutzen.
    }
    return [
      ...(main
        ? [
            {
              id: main.id,
              name: main.name,
              url: main.connection.url,
              tlsInsecure: main.connection.tlsInsecure,
              ownToken: true,
              primary: true,
              error: null,
            },
          ]
        : []),
      ...this.stored().map((s): DhcpServer => ({
        id: s.id,
        name: s.name,
        url: s.url,
        tlsInsecure: s.tlsInsecure,
        ownToken: s.token !== null,
        primary: false,
        error: this.errors.get(s.id) ?? null,
      })),
    ];
  }

  /** Prüft die Eingabe gegen den Server; gespeichert wird nur, was DHCP-Scopes liefern kann. */
  private async checked(
    raw: DhcpServerInput,
    id: string,
    previous: StoredServer | null,
  ): Promise<StoredServer> {
    const input = dhcpServerInput.parse(raw);
    const main = this.api.mainConnection();
    if (sameUrl(input.url, main.url))
      throw new ValidationError('Das ist bereits die Hauptverbindung');
    if (this.stored().some((s) => s.id !== id && sameUrl(s.url, input.url)))
      throw new ValidationError('Dieser Server ist schon eingetragen');
    const token = input.useMainToken ? null : (input.token ?? previous?.token ?? null);
    const server: StoredServer = {
      id,
      name: input.name,
      url: input.url,
      token,
      tlsInsecure: input.tlsInsecure,
    };
    await this.api.callWith(this.resolve(server, main).connection, 'dhcp/scopes/list');
    return server;
  }

  async addServer(raw: DhcpServerInput, user: User): Promise<DhcpServer> {
    const id = `srv-${randomBytes(4).toString('hex')}`;
    return this.api.audited(
      user,
      'technitium.dhcp.server.add',
      typeof raw.url === 'string' ? raw.url : '',
      {},
      async () => {
        const server = await this.checked(raw, id, null);
        this.store([...this.stored(), server]);
        this.errors.delete(id);
        return this.listServers().find((s) => s.id === id)!;
      },
    );
  }

  async updateServer(id: string, raw: DhcpServerInput, user: User): Promise<DhcpServer> {
    const previous = this.stored().find((s) => s.id === id);
    if (!previous) throw new NotFoundError('DHCP-Server');
    return this.api.audited(user, 'technitium.dhcp.server.update', previous.url, {}, async () => {
      const server = await this.checked(raw, id, previous);
      this.store(this.stored().map((s) => (s.id === id ? server : s)));
      this.errors.delete(id);
      return this.listServers().find((s) => s.id === id)!;
    });
  }

  deleteServer(id: string, user: User): Promise<void> {
    const previous = this.stored().find((s) => s.id === id);
    if (!previous) throw new NotFoundError('DHCP-Server');
    return this.api.audited(user, 'technitium.dhcp.server.delete', previous.url, {}, async () => {
      this.store(this.stored().filter((s) => s.id !== id));
      this.errors.delete(id);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lesen

  async scopes(): Promise<DhcpScope[]> {
    const all = await this.collect(async (target) => {
      const { scopes } = await this.api.callWith<{ scopes: RawScopeListEntry[] }>(
        target.connection,
        'dhcp/scopes/list',
      );
      // Je Scope die Details holen; es sind in der Regel nur wenige.
      const details = await Promise.all(
        scopes.map((scope) =>
          this.api.callWith<RawScope>(target.connection, 'dhcp/scopes/get', { name: scope.name }),
        ),
      );
      return scopes.map((entry, i): DhcpScope => {
        const d = details[i]!;
        return {
          server: target.id,
          serverName: target.name,
          name: entry.name,
          enabled: entry.enabled,
          startingAddress: entry.startingAddress,
          endingAddress: entry.endingAddress,
          subnetMask: entry.subnetMask,
          networkAddress: entry.networkAddress ?? null,
          routerAddress: d.routerAddress || null,
          domainName: d.domainName || null,
          dnsServers: d.dnsServers ?? [],
          leaseMinutes:
            (d.leaseTimeDays ?? 0) * 1440 +
            (d.leaseTimeHours ?? 0) * 60 +
            (d.leaseTimeMinutes ?? 0),
          exclusions: d.exclusions ?? [],
          reservations: (d.reservedLeases ?? []).map(toReservation),
          allowOnlyReservedLeases: d.allowOnlyReservedLeases ?? false,
        };
      });
    });
    const order = new Map(this.targets().map((t, i) => [t.id, i]));
    return all.sort(
      (a, b) =>
        a.name.localeCompare(b.name) || (order.get(a.server) ?? 0) - (order.get(b.server) ?? 0),
    );
  }

  async leases(): Promise<DhcpLease[]> {
    return this.collect(async (target) => {
      const { leases } = await this.api.callWith<{ leases: RawLease[] }>(
        target.connection,
        'dhcp/leases/list',
      );
      return leases.map((lease): DhcpLease => ({
        server: target.id,
        serverName: target.name,
        scope: lease.scope,
        type: lease.type === 'Reserved' ? 'Reserved' : 'Dynamic',
        hardwareAddress: lease.hardwareAddress,
        address: lease.address,
        hostName: lease.hostName || null,
        obtained: normalizeTime(lease.leaseObtained),
        expires: normalizeTime(lease.leaseExpires),
      }));
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Ändern

  /** Zusatz fürs Protokoll, damit erkennbar ist, welcher Server geändert wurde. */
  private where(target: Target, scope: string) {
    return target.id === MAIN_DHCP_SERVER ? { scope } : { scope, server: target.name };
  }

  setScopeEnabled(raw: DhcpScopeState, user: User): Promise<void> {
    const input = dhcpScopeState.parse(raw);
    const target = this.target(input.server);
    return this.api.audited(
      user,
      `technitium.dhcp.scope.${input.enabled ? 'enable' : 'disable'}`,
      input.scope,
      target.id === MAIN_DHCP_SERVER ? {} : { server: target.name },
      async () => {
        await this.api.callWith(
          target.connection,
          `dhcp/scopes/${input.enabled ? 'enable' : 'disable'}`,
          {
            name: input.scope,
          },
        );
      },
    );
  }

  private addParams(input: ReturnType<typeof dhcpReservationInput.parse>): Params {
    return {
      name: input.scope,
      hardwareAddress: input.hardwareAddress,
      ipAddress: input.ipAddress,
      ...(input.hostName ? { hostName: input.hostName } : {}),
      ...(input.comments ? { comments: input.comments } : {}),
    };
  }

  private describe = (input: {
    hardwareAddress: string;
    ipAddress?: string;
    hostName?: string | null;
  }) => [input.hardwareAddress, input.ipAddress, input.hostName].filter(Boolean).join(' · ');

  addReservation(raw: DhcpReservationInput, user: User): Promise<void> {
    const input = dhcpReservationInput.parse(raw);
    const target = this.target(input.server);
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.add',
      this.describe(input),
      this.where(target, input.scope),
      async () => {
        await this.api.callWith(
          target.connection,
          'dhcp/scopes/addReservedLease',
          this.addParams(input),
        );
      },
    );
  }

  /**
   * Technitium kennt kein „ändern“ für einzelne Reservierungen. Wir entfernen die alte und legen die
   * neue an. Schlägt das Anlegen fehl, wird die alte wiederhergestellt, damit nichts verloren geht.
   */
  updateReservation(raw: DhcpReservationUpdate, user: User): Promise<void> {
    const input = dhcpReservationUpdate.parse(raw);
    const target = this.target(input.server);
    const call = <T>(path: string, params?: Params) =>
      this.api.callWith<T>(target.connection, path, params);
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.update',
      this.describe(input),
      { ...this.where(target, input.scope), was: input.currentHardwareAddress },
      async () => {
        const { scopes } = await call<{ scopes: RawScopeListEntry[] }>('dhcp/scopes/list');
        if (!scopes.some((s) => s.name === input.scope))
          throw new TechnitiumError(`Scope „${input.scope}“ nicht gefunden`, 'api');
        const scope = await call<RawScope>('dhcp/scopes/get', { name: input.scope });
        const old = scope.reservedLeases?.find((r) =>
          sameMac(r.hardwareAddress, input.currentHardwareAddress),
        );
        if (!old) throw new TechnitiumError('Die Reservierung existiert nicht mehr', 'api');

        await call('dhcp/scopes/removeReservedLease', {
          name: input.scope,
          hardwareAddress: old.hardwareAddress,
        });
        try {
          await call('dhcp/scopes/addReservedLease', this.addParams(input));
        } catch (error) {
          try {
            await call('dhcp/scopes/addReservedLease', {
              name: input.scope,
              hardwareAddress: old.hardwareAddress,
              ipAddress: old.address,
              ...(old.hostName ? { hostName: old.hostName } : {}),
              ...(old.comments ? { comments: old.comments } : {}),
            });
          } catch {
            throw new TechnitiumError(
              `Die Änderung ist fehlgeschlagen und die alte Reservierung (${old.address}, ${old.hardwareAddress}) konnte nicht wiederhergestellt werden. Bitte neu anlegen.`,
              'api',
            );
          }
          throw error;
        }
      },
    );
  }

  deleteReservation(raw: DhcpReservationDelete, user: User): Promise<void> {
    const input = dhcpReservationDelete.parse(raw);
    const target = this.target(input.server);
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.delete',
      input.hardwareAddress,
      this.where(target, input.scope),
      async () => {
        await this.api.callWith(target.connection, 'dhcp/scopes/removeReservedLease', {
          name: input.scope,
          hardwareAddress: input.hardwareAddress,
        });
      },
    );
  }

  leaseAction(raw: DhcpLeaseAction, user: User): Promise<void> {
    const input = dhcpLeaseAction.parse(raw);
    const path = {
      reserve: 'dhcp/leases/convertToReserved',
      unreserve: 'dhcp/leases/convertToDynamic',
      remove: 'dhcp/leases/remove',
    }[input.action];
    const target = this.target(input.server);
    return this.api.audited(
      user,
      `technitium.dhcp.lease.${input.action}`,
      input.hardwareAddress,
      this.where(target, input.scope),
      async () => {
        await this.api.callWith(target.connection, path, {
          name: input.scope,
          hardwareAddress: input.hardwareAddress,
        });
      },
    );
  }
}

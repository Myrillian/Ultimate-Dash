import type {
  DhcpLease,
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
  dhcpLeaseAction,
  dhcpReservationDelete,
  dhcpReservationInput,
  dhcpReservationUpdate,
  dhcpScopeState,
} from '@ultimate-dash/shared';
import { TechnitiumError } from './client.js';
import type { Params } from './records.js';

/** Was DhcpService vom Technitium-Dienst braucht. */
export interface TechnitiumApi {
  call<T>(path: string, params?: Params): Promise<T>;
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

const toReservation = (raw: NonNullable<RawScope['reservedLeases']>[number]): DhcpReservation => ({
  hardwareAddress: raw.hardwareAddress,
  address: raw.address,
  hostName: raw.hostName || null,
  comments: raw.comments || null,
});

export class DhcpService {
  constructor(private readonly api: TechnitiumApi) {}

  async scopes(): Promise<DhcpScope[]> {
    const { scopes } = await this.api.call<{ scopes: RawScopeListEntry[] }>('dhcp/scopes/list');
    // Je Scope die Details holen; es sind in der Regel nur wenige.
    const details = await Promise.all(
      scopes.map((scope) => this.api.call<RawScope>('dhcp/scopes/get', { name: scope.name })),
    );
    return scopes
      .map((entry, i): DhcpScope => {
        const d = details[i]!;
        return {
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
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async leases(): Promise<DhcpLease[]> {
    const { leases } = await this.api.call<{ leases: RawLease[] }>('dhcp/leases/list');
    return leases.map((lease): DhcpLease => ({
      scope: lease.scope,
      type: lease.type === 'Reserved' ? 'Reserved' : 'Dynamic',
      hardwareAddress: lease.hardwareAddress,
      address: lease.address,
      hostName: lease.hostName || null,
      obtained: lease.leaseObtained ?? null,
      expires: lease.leaseExpires ?? null,
    }));
  }

  setScopeEnabled(raw: DhcpScopeState, user: User): Promise<void> {
    const input = dhcpScopeState.parse(raw);
    return this.api.audited(
      user,
      `technitium.dhcp.scope.${input.enabled ? 'enable' : 'disable'}`,
      input.scope,
      {},
      async () => {
        await this.api.call(`dhcp/scopes/${input.enabled ? 'enable' : 'disable'}`, {
          name: input.scope,
        });
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
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.add',
      this.describe(input),
      { scope: input.scope },
      async () => {
        await this.api.call('dhcp/scopes/addReservedLease', this.addParams(input));
      },
    );
  }

  /**
   * Technitium kennt kein „ändern“ für einzelne Reservierungen. Wir entfernen die alte und legen die
   * neue an. Schlägt das Anlegen fehl, wird die alte wiederhergestellt, damit nichts verloren geht.
   */
  updateReservation(raw: DhcpReservationUpdate, user: User): Promise<void> {
    const input = dhcpReservationUpdate.parse(raw);
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.update',
      this.describe(input),
      { scope: input.scope, was: input.currentHardwareAddress },
      async () => {
        const { scopes } = await this.api.call<{ scopes: RawScopeListEntry[] }>('dhcp/scopes/list');
        if (!scopes.some((s) => s.name === input.scope))
          throw new TechnitiumError(`Scope „${input.scope}“ nicht gefunden`, 'api');
        const scope = await this.api.call<RawScope>('dhcp/scopes/get', { name: input.scope });
        const old = scope.reservedLeases?.find((r) =>
          sameMac(r.hardwareAddress, input.currentHardwareAddress),
        );
        if (!old) throw new TechnitiumError('Die Reservierung existiert nicht mehr', 'api');

        await this.api.call('dhcp/scopes/removeReservedLease', {
          name: input.scope,
          hardwareAddress: old.hardwareAddress,
        });
        try {
          await this.api.call('dhcp/scopes/addReservedLease', this.addParams(input));
        } catch (error) {
          try {
            await this.api.call('dhcp/scopes/addReservedLease', {
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
    return this.api.audited(
      user,
      'technitium.dhcp.reservation.delete',
      input.hardwareAddress,
      { scope: input.scope },
      async () => {
        await this.api.call('dhcp/scopes/removeReservedLease', {
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
    return this.api.audited(
      user,
      `technitium.dhcp.lease.${input.action}`,
      input.hardwareAddress,
      { scope: input.scope },
      async () => {
        await this.api.call(path, { name: input.scope, hardwareAddress: input.hardwareAddress });
      },
    );
  }
}

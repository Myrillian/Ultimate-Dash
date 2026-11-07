import {
  categoryColors,
  cidrToString,
  cidrsOverlap,
  ipamImportInput,
  ipv4Segments,
  ipv4ToInt,
  maskToPrefix,
  parseCidr,
  type DhcpScope,
  type IpamImportInput,
  type IpamNetwork,
  type IpamSuggestion,
  type IpamSync,
  type ParsedCidr,
  type User,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import { ValidationError } from '../db/repository.js';
import { TechnitiumError } from '../technitium/client.js';
import type { IpamRepository } from './repository.js';

/** Das Netz, das ein DHCP-Scope bedient; null, wenn die Maske ungewöhnlich ist (außerhalb /16 bis /30). */
export function scopeNetwork(scope: DhcpScope): ParsedCidr | null {
  const prefix = maskToPrefix(scope.subnetMask);
  const start = ipv4ToInt(scope.startingAddress);
  if (prefix === null || start === null || prefix < 16 || prefix > 30) return null;
  const size = 2 ** (32 - prefix);
  const first = start - (start % size);
  return { first, last: first + size - 1, prefix, size };
}

const DHCP_CATEGORY = 'DHCP';

export class IpamSyncService {
  constructor(
    private readonly options: {
      repo: IpamRepository;
      audit: AuditLog;
      scopes: () => Promise<DhcpScope[]>;
    },
  ) {}

  async compare(): Promise<IpamSync> {
    let scopes: DhcpScope[];
    try {
      scopes = await this.options.scopes();
    } catch (error) {
      const reason =
        error instanceof TechnitiumError && error.kind === 'not-configured'
          ? 'Technitium ist nicht verbunden.'
          : error instanceof Error
            ? error.message
            : 'Technitium nicht erreichbar';
      return { available: false, reason, suggestions: [], drift: [] };
    }
    const { networks } = this.options.repo.all();
    const result: IpamSync = { available: true, reason: null, suggestions: [], drift: [] };

    for (const scope of scopes) {
      const cidr = scopeNetwork(scope);
      if (!cidr) continue;
      const same = networks.find(
        (n) => parseCidr(n.cidr)!.first === cidr.first && parseCidr(n.cidr)!.prefix === cidr.prefix,
      );
      const router = scope.routerAddress;
      const routerInside =
        router !== null &&
        ipv4ToInt(router) !== null &&
        ipv4ToInt(router)! > cidr.first &&
        ipv4ToInt(router)! < cidr.last;

      if (same) {
        if (
          routerInside &&
          same.gateway !== router &&
          !result.drift.some((d) => d.networkId === same.id && d.remote === router)
        )
          result.drift.push({
            networkId: same.id,
            networkName: same.name,
            scope: scope.name,
            field: 'gateway',
            local: same.gateway,
            remote: router!,
          });
        continue;
      }
      const clash = networks.find((n) => cidrsOverlap(cidr, parseCidr(n.cidr)!));
      const hostFirst = cidr.first + 1;
      const hostLast = cidr.last - 1;
      const pools = ipv4Segments(scope.startingAddress, scope.endingAddress, scope.exclusions)
        .map((p) => ({
          s: Math.max(ipv4ToInt(p.start)!, hostFirst),
          e: Math.min(ipv4ToInt(p.end)!, hostLast),
          p,
        }))
        .filter((x) => x.s <= x.e)
        .map((x) => ({
          start: x.s === ipv4ToInt(x.p.start) ? x.p.start : intToString(x.s),
          end: x.e === ipv4ToInt(x.p.end) ? x.p.end : intToString(x.e),
        }));
      // Bedienen zwei Server dasselbe Netz (geteilter Scope), wird daraus ein Vorschlag.
      const twin = result.suggestions.find((x) => x.cidr === cidrToString(cidr));
      if (twin) {
        for (const pool of pools)
          if (!twin.pools.some((p) => p.start === pool.start && p.end === pool.end))
            twin.pools.push(pool);
        twin.pools.sort((a, b) => ipv4ToInt(a.start)! - ipv4ToInt(b.start)!);
        continue;
      }
      result.suggestions.push({
        scope: scope.name,
        cidr: cidrToString(cidr),
        gateway: routerInside ? router : null,
        domain: scope.domainName,
        pools,
        overlaps: clash ? `${clash.name} (${clash.cidr})` : null,
      } satisfies IpamSuggestion);
    }
    return result;
  }

  /** Legt Netze (und auf Wunsch DHCP-Bereiche) aus den gewählten Scopes an. */
  async import(raw: IpamImportInput, user: User): Promise<IpamNetwork[]> {
    const input = ipamImportInput.parse(raw);
    const sync = await this.compare();
    if (!sync.available) throw new ValidationError(sync.reason ?? 'Technitium nicht erreichbar');
    const chosen = input.scopes.map((name) => {
      const s = sync.suggestions.find((x) => x.scope === name);
      if (!s) throw new ValidationError(`Zu „${name}“ gibt es nichts zu übernehmen`);
      if (s.overlaps) throw new ValidationError(`„${name}“ überschneidet sich mit ${s.overlaps}`);
      return s;
    });

    const { repo, audit } = this.options;
    let categoryId: number | null = null;
    if (input.withPoolRange && chosen.some((s) => s.pools.length > 0)) {
      const data = repo.all();
      const existing = data.categories.find(
        (c) => c.name.toLowerCase() === DHCP_CATEGORY.toLowerCase(),
      );
      categoryId =
        existing?.id ??
        repo.createCategory(
          {
            name: DHCP_CATEGORY,
            color:
              categoryColors.find((c) => !data.categories.some((x) => x.color === c)) ??
              categoryColors[0],
            description: 'Von DHCP verteilte Adressen',
          },
          user,
        ).id;
    }

    const created: IpamNetwork[] = [];
    for (const s of chosen) {
      const network = repo.createNetwork(
        {
          name: s.scope,
          cidr: s.cidr,
          gateway: s.gateway,
          description: s.domain ? `Domäne ${s.domain}` : null,
        },
        user,
      );
      created.push(network);
      if (categoryId !== null)
        for (const pool of s.pools)
          repo.createRange(
            {
              networkId: network.id,
              categoryId,
              startAddress: pool.start,
              endAddress: pool.end,
              label: `DHCP-Pool ${s.scope}`,
            },
            user,
          );
    }
    audit.record({
      user,
      action: 'ipam.import',
      target: chosen.map((s) => s.scope).join(', '),
      details: { withPoolRange: input.withPoolRange },
      ok: true,
    });
    return created;
  }
}

function intToString(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

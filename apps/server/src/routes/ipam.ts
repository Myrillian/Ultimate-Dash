import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IpamReachability } from '@ultimate-dash/shared';
import type { IpamHostStore } from '../ipam/hosts.js';
import type { IpamScanner } from '../ipam/scanner.js';
import type { IpamRepository } from '../ipam/repository.js';
import type { IpamSyncService } from '../ipam/sync.js';
import type { IpamUsageService } from '../ipam/usage.js';
import { vendorOfPrefix } from '../ipam/vendors.js';
import { NotFoundError } from '../db/repository.js';
import { TechnitiumError } from '../technitium/client.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function ipamRoutes(
  app: FastifyInstance,
  {
    repo,
    usage,
    sync,
    scanner,
    hosts,
  }: {
    repo: IpamRepository;
    usage: IpamUsageService;
    sync: IpamSyncService;
    scanner: IpamScanner;
    hosts: IpamHostStore;
  },
) {
  app.get('/ipam', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return repo.all();
  });

  // Belegung aus Technitium; Fehler dort führen nicht zu einem Fehlerstatus, sondern zu `available: false`.
  app.get('/ipam/usage', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return usage.usage(repo.all());
  });

  // Hersteller zu MAC-Kennungen (erste drei Byte); Lesen, aus der mitgelieferten IEEE-Liste.
  app.get('/ipam/vendors', async (request, reply) => {
    reply.header('cache-control', 'private, max-age=86400');
    const { prefixes } = z
      .object({
        prefixes: z
          .string()
          .max(20_000)
          .transform((value) => [...new Set(value.split(',').filter(Boolean))].slice(0, 2000)),
      })
      .parse(request.query);
    return Object.fromEntries(
      prefixes
        .filter((p) => /^[0-9A-Fa-f]{6}$/.test(p))
        .map((p) => [p.toUpperCase(), vendorOfPrefix(p)]),
    ) satisfies Record<string, string | null>;
  });

  // Alles zu einer Adresse für das Seitenfenster (Lesen; auch für Nur-lesen-Benutzer).
  app.get('/ipam/ip/:address', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { address } = z.object({ address: z.ipv4() }).parse(request.params);
    try {
      const detail = await usage.detail(repo.all(), address);
      if (!detail) throw new NotFoundError('Adresse');
      return detail;
    } catch (error) {
      if (error instanceof TechnitiumError)
        return reply.code(503).send({ error: error.message, code: error.kind });
      throw error;
    }
  });

  // Abgleich mit den DHCP-Scopes in Technitium: Netze, die sich übernehmen lassen, und Abweichungen.
  app.get('/ipam/sync', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return sync.compare();
  });

  app.post('/ipam/import', async (request, reply) =>
    reply.code(201).send(await sync.import(request.body as never, request.user!)),
  );

  // Ping-Prüfung: Einstellungen, Status und ein Durchlauf auf Abruf.
  app.get('/ipam/scan', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return scanner.status();
  });
  app.put('/ipam/scan', async (request) => scanner.save(request.body, request.user!));
  app.post('/ipam/scan/run', async (request, reply) =>
    reply.code(202).send(scanner.runInBackground(request.user!)),
  );

  // Erreichbarkeit aller bekannten Adressen, z. B. für die DNS-Ansicht.
  app.get('/ipam/reachability', async (_request, reply): Promise<IpamReachability> => {
    reply.header('cache-control', 'no-store');
    return {
      scanned: repo
        .all()
        .networks.filter((n) => n.scan && n.lastScanAt)
        .map((n) => n.cidr),
      hosts: Object.fromEntries(
        hosts.all().map((h) => [h.address, { alive: h.alive, lastSeen: h.lastSeenAt }]),
      ),
    };
  });

  app.put('/ipam/hosts/:id', async (request, reply) => {
    hosts.update(idParams.parse(request.params).id, request.body as never, request.user!);
    return reply.code(204).send();
  });
  app.delete('/ipam/hosts/:id', async (request, reply) => {
    hosts.delete(idParams.parse(request.params).id, request.user!);
    return reply.code(204).send();
  });

  app.post('/ipam/networks', async (request, reply) =>
    reply.code(201).send(repo.createNetwork(request.body as never, request.user!)),
  );
  app.put('/ipam/networks/:id', async (request) =>
    repo.updateNetwork(idParams.parse(request.params).id, request.body as never, request.user!),
  );
  app.delete('/ipam/networks/:id', async (request, reply) => {
    repo.deleteNetwork(idParams.parse(request.params).id, request.user!);
    return reply.code(204).send();
  });

  app.post('/ipam/categories', async (request, reply) =>
    reply.code(201).send(repo.createCategory(request.body as never, request.user!)),
  );
  app.put('/ipam/categories/:id', async (request) =>
    repo.updateCategory(idParams.parse(request.params).id, request.body as never, request.user!),
  );
  app.delete('/ipam/categories/:id', async (request, reply) => {
    repo.deleteCategory(idParams.parse(request.params).id, request.user!);
    return reply.code(204).send();
  });

  app.post('/ipam/ranges', async (request, reply) =>
    reply.code(201).send(repo.createRange(request.body as never, request.user!)),
  );
  app.put('/ipam/ranges/:id', async (request) =>
    repo.updateRange(idParams.parse(request.params).id, request.body as never, request.user!),
  );
  app.delete('/ipam/ranges/:id', async (request, reply) => {
    repo.deleteRange(idParams.parse(request.params).id, request.user!);
    return reply.code(204).send();
  });
}

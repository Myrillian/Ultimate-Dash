import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IpamRepository } from '../ipam/repository.js';
import type { IpamSyncService } from '../ipam/sync.js';
import type { IpamUsageService } from '../ipam/usage.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function ipamRoutes(
  app: FastifyInstance,
  { repo, usage, sync }: { repo: IpamRepository; usage: IpamUsageService; sync: IpamSyncService },
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

  // Abgleich mit den DHCP-Scopes in Technitium: Netze, die sich übernehmen lassen, und Abweichungen.
  app.get('/ipam/sync', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return sync.compare();
  });

  app.post('/ipam/import', async (request, reply) =>
    reply.code(201).send(await sync.import(request.body as never, request.user!)),
  );

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

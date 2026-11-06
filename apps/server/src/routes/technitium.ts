import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { blockingAction, statsRange } from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { TechnitiumService } from '../technitium/service.js';

const summaryQuery = z.object({ range: statsRange.default('day') });

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user!.role === 'admin') return true;
  void reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
  return false;
}

export async function technitiumRoutes(
  app: FastifyInstance,
  { technitium, audit }: { technitium: TechnitiumService; audit: AuditLog },
) {
  app.get('/technitium/settings', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return technitium.getSettings();
  });

  app.put('/technitium/settings', async (request) =>
    technitium.save(request.body as never, request.user!),
  );

  app.delete('/technitium/settings', async (request, reply) => {
    technitium.disconnect(request.user!);
    return reply.code(204).send();
  });

  // Prüft Zugangsdaten, ohne sie zu speichern.
  app.post('/technitium/test', async (request) => technitium.test(request.body as never));

  app.get('/technitium/summary', async (request, reply) => {
    const { range } = summaryQuery.parse(request.query);
    reply.header('cache-control', 'no-store');
    return technitium.summary(range);
  });

  app.post('/technitium/blocking', async (request, reply) => {
    await technitium.blocking(blockingAction.parse(request.body), request.user!);
    return reply.code(204).send();
  });

  app.get('/audit', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return audit.list(200);
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dnsName } from '@ultimate-dash/shared';
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

  app.get('/technitium/zones', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return technitium.zones();
  });

  app.get('/technitium/records', async (request, reply) => {
    const { zone } = z.object({ zone: dnsName }).parse(request.query);
    reply.header('cache-control', 'no-store');
    return technitium.records(zone);
  });

  app.post('/technitium/records', async (request, reply) => {
    await technitium.addRecord(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.put('/technitium/records', async (request, reply) => {
    await technitium.updateRecord(request.body as never, request.user!);
    return reply.code(204).send();
  });

  // Löschen per POST, weil nicht jeder Proxy einen Body bei DELETE durchreicht.
  app.post('/technitium/records/delete', async (request, reply) => {
    await technitium.deleteRecord(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.get('/audit', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    return audit.list(200);
  });
}

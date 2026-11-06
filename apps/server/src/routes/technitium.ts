import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dnsName } from '@ultimate-dash/shared';
import { blockingAction, statsRange } from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { DhcpService } from '../technitium/dhcp.js';
import type { TechnitiumService } from '../technitium/service.js';

const summaryQuery = z.object({ range: statsRange.default('day') });

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user!.role === 'admin') return true;
  void reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
  return false;
}

export async function technitiumRoutes(
  app: FastifyInstance,
  {
    technitium,
    dhcp,
    audit,
  }: { technitium: TechnitiumService; dhcp: DhcpService; audit: AuditLog },
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

  app.get('/technitium/dhcp/scopes', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return dhcp.scopes();
  });

  app.get('/technitium/dhcp/leases', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return dhcp.leases();
  });

  app.post('/technitium/dhcp/scopes/state', async (request, reply) => {
    await dhcp.setScopeEnabled(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.post('/technitium/dhcp/reservations', async (request, reply) => {
    await dhcp.addReservation(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.put('/technitium/dhcp/reservations', async (request, reply) => {
    await dhcp.updateReservation(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.post('/technitium/dhcp/reservations/delete', async (request, reply) => {
    await dhcp.deleteReservation(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.post('/technitium/dhcp/leases/action', async (request, reply) => {
    await dhcp.leaseAction(request.body as never, request.user!);
    return reply.code(204).send();
  });

  app.get('/audit', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(1000).default(500) })
      .parse(request.query);
    return audit.list(limit);
  });
}

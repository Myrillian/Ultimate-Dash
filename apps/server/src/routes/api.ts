import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { groupInput, moveServiceInput, reorderInput, serviceInput } from '@ultimate-dash/shared';
import type { Repository } from '../db/repository.js';
import type { EventHub } from '../events.js';
import type { StatusMonitor } from '../status/monitor.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export interface ApiDeps {
  repo: Repository;
  events: EventHub;
  monitor: StatusMonitor;
}

export async function apiRoutes(app: FastifyInstance, { repo, events, monitor }: ApiDeps) {
  const changed = () => events.publish({ type: 'dashboard-changed' });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/dashboard', async () => repo.getDashboard());

  app.get('/status', async () => monitor.snapshot());

  // Gruppen
  app.post('/groups', async (request, reply) => {
    const created = repo.createGroup(groupInput.parse(request.body));
    changed();
    return reply.code(201).send(created);
  });

  app.put('/groups/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = repo.updateGroup(id, groupInput.parse(request.body));
    changed();
    return updated;
  });

  app.delete('/groups/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    repo.deleteGroup(id);
    changed();
    return reply.code(204).send();
  });

  app.put('/groups/order', async (request, reply) => {
    repo.reorderGroups(reorderInput.parse(request.body).ids);
    changed();
    return reply.code(204).send();
  });

  // Services
  app.post('/services', async (request, reply) => {
    const created = repo.createService(serviceInput.parse(request.body));
    changed();
    void monitor.checkNow(created);
    return reply.code(201).send(created);
  });

  app.put('/services/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = repo.updateService(id, serviceInput.parse(request.body));
    changed();
    void monitor.checkNow(updated);
    return updated;
  });

  app.delete('/services/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    repo.deleteService(id);
    monitor.forget(id);
    changed();
    return reply.code(204).send();
  });

  /** Ordnet Services einer Gruppe neu (auch Verschieben aus anderen Gruppen). */
  app.put('/services/arrange', async (request, reply) => {
    const { groupId, ids } = moveServiceInput.parse(request.body);
    repo.arrangeServices(groupId, ids);
    changed();
    return reply.code(204).send();
  });

  // Live-Ereignisse per Server-Sent Events
  app.get('/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'status', data: monitor.snapshot() });
    const unsubscribe = events.subscribe(send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

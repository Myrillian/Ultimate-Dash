import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  copyDashboardInput,
  groupInput,
  moveServiceInput,
  reorderInput,
  serviceInput,
} from '@ultimate-dash/shared';
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
  /** Meldet nur dem Besitzer, dass sich sein Dashboard geändert hat (andere Tabs/Geräte desselben Benutzers). */
  const changed = (userId: number) => events.publish({ type: 'dashboard-changed' }, userId);
  const uid = (request: { user: { id: number } | null }) => request.user!.id;

  const ownStatus = (userId: number) => {
    const ids = new Set(repo.listServices(userId).map((service) => service.id));
    return monitor.snapshot().filter((status) => ids.has(status.serviceId));
  };

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/dashboard', async (request) => repo.getDashboard(uid(request)));

  /** Dashboards anderer Benutzer als Kopiervorlage. */
  app.get('/dashboards', async (request) => repo.listSources(uid(request)));

  app.post('/dashboard/copy', async (request) => {
    const summary = repo.copyFrom(uid(request), copyDashboardInput.parse(request.body));
    changed(uid(request));
    for (const service of repo.listServices(uid(request))) void monitor.checkNow(service);
    return summary;
  });

  app.get('/status', async (request) => ownStatus(uid(request)));

  // Gruppen
  app.post('/groups', async (request, reply) => {
    const created = repo.createGroup(uid(request), groupInput.parse(request.body));
    changed(uid(request));
    return reply.code(201).send(created);
  });

  app.put('/groups/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = repo.updateGroup(uid(request), id, groupInput.parse(request.body));
    changed(uid(request));
    return updated;
  });

  app.delete('/groups/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    repo.deleteGroup(uid(request), id);
    changed(uid(request));
    return reply.code(204).send();
  });

  app.put('/groups/order', async (request, reply) => {
    repo.reorderGroups(uid(request), reorderInput.parse(request.body).ids);
    changed(uid(request));
    return reply.code(204).send();
  });

  // Services
  app.post('/services', async (request, reply) => {
    const created = repo.createService(uid(request), serviceInput.parse(request.body));
    changed(uid(request));
    void monitor.checkNow(created);
    return reply.code(201).send(created);
  });

  app.put('/services/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const updated = repo.updateService(uid(request), id, serviceInput.parse(request.body));
    changed(uid(request));
    void monitor.checkNow(updated);
    return updated;
  });

  app.delete('/services/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    repo.deleteService(uid(request), id);
    monitor.forget(id);
    changed(uid(request));
    return reply.code(204).send();
  });

  /** Ordnet Services einer Gruppe neu (auch Verschieben aus anderen Gruppen). */
  app.put('/services/arrange', async (request, reply) => {
    const { groupId, ids } = moveServiceInput.parse(request.body);
    repo.arrangeServices(uid(request), groupId, ids);
    changed(uid(request));
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
    const userId = uid(request);
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'status', data: ownStatus(userId) });
    // Jeder sieht nur Ereignisse zu seinem eigenen Dashboard und den Status seiner eigenen Services.
    const unsubscribe = events.subscribe((event, ownerId) => {
      if (ownerId !== undefined && ownerId !== userId) return;
      if (event.type === 'status') {
        const ids = new Set(repo.listServices(userId).map((service) => service.id));
        const own = event.data.filter((status) => ids.has(status.serviceId));
        if (own.length > 0) send({ type: 'status', data: own });
        return;
      }
      send(event);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

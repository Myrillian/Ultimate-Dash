import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ProxmoxService } from '../proxmox/service.js';

/** Proxmox ist nur für Admins sichtbar, auch die Kennzahlen. */
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user!.role === 'admin') return true;
  void reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
  return false;
}

export async function proxmoxRoutes(
  app: FastifyInstance,
  { proxmox }: { proxmox: ProxmoxService },
) {
  app.addHook('preHandler', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
  });

  app.get('/proxmox/settings', async () => proxmox.getSettings());

  app.put('/proxmox/settings', async (request) =>
    proxmox.save(request.body as never, request.user!),
  );

  app.delete('/proxmox/settings', async (request, reply) => {
    proxmox.disconnect(request.user!);
    return reply.code(204).send();
  });

  // Prüft Zugangsdaten, ohne sie zu speichern.
  app.post('/proxmox/test', async (request) => proxmox.test(request.body as never));

  app.get('/proxmox/summary', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return proxmox.summary();
  });
}

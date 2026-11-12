import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZoraxyService } from '../zoraxy/service.js';

/** Zoraxy ist nur für Admins sichtbar, auch die Kennzahlen. */
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user!.role === 'admin') return true;
  void reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
  return false;
}

export async function zoraxyRoutes(app: FastifyInstance, { zoraxy }: { zoraxy: ZoraxyService }) {
  app.addHook('preHandler', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;
  });

  app.get('/zoraxy/settings', async () => zoraxy.getSettings());

  app.put('/zoraxy/settings', async (request) => zoraxy.save(request.body as never, request.user!));

  app.delete('/zoraxy/settings', async (request, reply) => {
    zoraxy.disconnect(request.user!);
    return reply.code(204).send();
  });

  // Prüft Zugangsdaten, ohne sie zu speichern.
  app.post('/zoraxy/test', async (request) => zoraxy.test(request.body as never));

  app.get('/zoraxy/summary', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return zoraxy.summary();
  });
}

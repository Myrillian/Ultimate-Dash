import type { FastifyInstance } from 'fastify';
import { updateInstallInput } from '@ultimate-dash/shared';
import type { UpdateService } from '../update/service.js';

/** Update-Prüfung und -Installation sind nur für Admins. */
export async function updateRoutes(app: FastifyInstance, { update }: { update: UpdateService }) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    }
  });

  app.get('/update', async () => update.status());

  // „Jetzt prüfen“ umgeht den Zwischenspeicher.
  app.post('/update/check', async () => update.status(true));

  app.post('/update/install', async (request, reply) => {
    const input = updateInstallInput.parse(request.body);
    const status = await update.install(input, request.user!);
    return reply.code(202).send(status);
  });
}

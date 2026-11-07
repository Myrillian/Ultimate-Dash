import type { FastifyInstance } from 'fastify';
import type { MailService } from '../mail/service.js';

/** Mailserver-Einstellungen sind nur für Admins. */
export async function mailRoutes(app: FastifyInstance, { mail }: { mail: MailService }) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    }
  });

  app.get('/mail/settings', async () => mail.getSettings());

  app.put('/mail/settings', async (request) => mail.save(request.body as never, request.user!));

  app.delete('/mail/settings', async (request, reply) => {
    mail.disconnect(request.user!);
    return reply.code(204).send();
  });

  // Schickt eine Testmail mit den eingegebenen Werten, ohne sie zu speichern.
  app.post('/mail/test', async (request) => mail.test(request.body as never, request.user!));
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { feedPreviewInput } from '@ultimate-dash/shared';
import type { FeedService } from '../feeds/service.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * RSS-Feeds: Meldungen und Bilder für alle angemeldeten Benutzer,
 * Verwaltung (alle schreibenden Routen) nur für Admins – das erzwingt der Auth-Guard.
 */
export async function feedRoutes(app: FastifyInstance, { feeds }: { feeds: FeedService }) {
  app.get('/feeds/items', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return feeds.items(request.query);
  });

  app.get('/feeds/images/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const image = await feeds.image(id);
    if (!image) return reply.code(404).send({ error: 'Kein Bild' });
    return reply
      .header('content-type', image.type)
      .header('cache-control', 'private, max-age=86400')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(image.body);
  });

  app.get('/feeds', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return feeds.list();
  });

  app.post('/feeds/preview', async (request) =>
    feeds.preview(feedPreviewInput.parse(request.body).url),
  );

  app.post('/feeds', async (request, reply) =>
    reply.code(201).send(await feeds.create(request.body, request.user!)),
  );

  app.post('/feeds/defaults', async (request) => feeds.restoreDefaults(request.user!));

  app.put('/feeds/:id', async (request) =>
    feeds.update(idParam.parse(request.params).id, request.body, request.user!),
  );

  app.post('/feeds/:id/refresh', async (request) =>
    feeds.refresh(idParam.parse(request.params).id),
  );

  app.delete('/feeds/:id', async (request, reply) => {
    feeds.delete(idParam.parse(request.params).id, request.user!);
    return reply.code(204).send();
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { searchIconify, type IconCatalogService } from '../icons/catalog.js';

const searchQuery = z.object({ q: z.string().trim().min(2).max(60) });

export async function iconRoutes(app: FastifyInstance, { icons }: { icons: IconCatalogService }) {
  app.get('/icons', async (_request, reply) => {
    reply.header('cache-control', 'private, max-age=3600');
    return icons.get();
  });

  // Iconify-Suche (Material Design Icons, Simple Icons) über den Server, nie direkt aus dem Browser.
  const cache = new Map<string, string[]>();
  app.get('/icons/iconify', async (request, reply) => {
    const { q } = searchQuery.parse(request.query);
    const key = q.toLowerCase();
    let result = cache.get(key);
    if (!result) {
      try {
        result = await searchIconify(key);
      } catch (error) {
        request.log.warn({ err: error }, 'Iconify-Suche fehlgeschlagen');
        return reply.code(502).send({ error: 'Iconify ist nicht erreichbar' });
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
    }
    return { icons: result };
  });
}

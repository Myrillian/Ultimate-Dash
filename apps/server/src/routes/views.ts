import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { savedViewInput, viewScopes, type SavedView } from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import { NotFoundError } from '../db/repository.js';
import { savedViews } from '../db/schema.js';

const toView = (row: typeof savedViews.$inferSelect): SavedView => ({
  id: row.id,
  scope: row.scope,
  name: row.name,
  params: row.params,
  hidden: row.hidden,
});

/** Gespeicherte Ansichten; jeder Benutzer sieht und ändert nur seine eigenen. */
export async function viewRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const uid = (request: { user: { id: number } | null }) => request.user!.id;

  app.get('/views', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { scope } = z.object({ scope: z.enum(viewScopes) }).parse(request.query);
    return db
      .select()
      .from(savedViews)
      .where(and(eq(savedViews.userId, uid(request)), eq(savedViews.scope, scope)))
      .orderBy(asc(savedViews.name))
      .all()
      .map(toView);
  });

  // Gleicher Name überschreibt die vorhandene Ansicht.
  app.put('/views', async (request) => {
    const input = savedViewInput.parse(request.body);
    const params = Object.fromEntries(Object.entries(input.params).filter(([, v]) => v !== ''));
    const row = db
      .insert(savedViews)
      .values({
        userId: uid(request),
        scope: input.scope,
        name: input.name,
        params,
        hidden: input.hidden,
      })
      .onConflictDoUpdate({
        target: [savedViews.userId, savedViews.scope, savedViews.name],
        set: { params, hidden: input.hidden },
      })
      .returning()
      .get();
    return toView(row);
  });

  app.delete('/views/:id', async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const removed = db
      .delete(savedViews)
      .where(and(eq(savedViews.id, id), eq(savedViews.userId, uid(request))))
      .returning({ id: savedViews.id })
      .all();
    if (removed.length === 0) throw new NotFoundError('Ansicht');
    return reply.code(204).send();
  });
}

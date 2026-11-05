import Fastify, { type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { createRepository, NotFoundError, ValidationError } from './db/repository.js';
import { EventHub } from './events.js';
import { apiRoutes } from './routes/api.js';
import { StatusMonitor } from './status/monitor.js';

export async function buildApp(
  config: AppConfig,
  options: { logger?: FastifyServerOptions['logger']; startMonitor?: boolean } = {},
) {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
    // Jede Anfrage zu loggen wäre bei Healthchecks und Live-Updates nur Rauschen.
    disableRequestLogging: process.env.LOG_REQUESTS !== 'true',
  });

  const { db, close } = openDatabase(config.databaseFile, config.migrationsFolder);
  const repo = createRepository(db);
  const events = new EventHub();
  const monitor = new StatusMonitor({
    intervalMs: config.statusIntervalSeconds * 1000,
    timeoutMs: config.statusTimeoutMs,
    listServices: () => repo.listServices(),
    events,
    onError: (error) => app.log.error({ err: error }, 'Statusprüfung fehlgeschlagen'),
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'SAMEORIGIN');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Ungültige Eingabe',
        issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
    }
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof ValidationError) return reply.code(400).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: 'Interner Serverfehler' });
  });

  await app.register(apiRoutes, { prefix: '/api', repo, events, monitor });

  if (config.webRoot && existsSync(config.webRoot)) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      wildcard: false,
      setHeaders(res, path) {
        // Gehashte Build-Dateien dürfen lange gecacht werden, index.html nie.
        res.setHeader(
          'cache-control',
          path.includes(`${join('_app', 'immutable')}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
    // SPA-Fallback: alle unbekannten Seiten liefern die App aus.
    app.setNotFoundHandler((request, reply) => {
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !request.url.startsWith('/api/')
      ) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Nicht gefunden' });
    });
  }

  app.addHook('onReady', async () => {
    if (options.startMonitor !== false) monitor.start();
  });
  app.addHook('onClose', async () => {
    monitor.stop();
    close();
  });

  return { app, repo, monitor, events };
}

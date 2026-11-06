import Fastify, { type FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { createAuditLog } from './db/audit.js';
import { createRepository, NotFoundError, ValidationError } from './db/repository.js';
import { EventHub } from './events.js';
import { registerAuthGuard } from './auth/guard.js';
import { createOidc } from './auth/oidc.js';
import { LoginRateLimiter } from './auth/rate-limit.js';
import { authRoutes } from './auth/routes.js';
import { createAuthStore } from './auth/store.js';
import { IconCatalogService } from './icons/catalog.js';
import { apiRoutes } from './routes/api.js';
import { configRoutes } from './routes/config.js';
import { iconRoutes } from './routes/icons.js';
import { IpamRepository } from './ipam/repository.js';
import { IpamHostStore } from './ipam/hosts.js';
import { systemPing, type Pinger } from './ipam/ping.js';
import { IpamScanner } from './ipam/scanner.js';
import { IpamSyncService } from './ipam/sync.js';
import { IpamUsageService } from './ipam/usage.js';
import { ipamRoutes } from './routes/ipam.js';
import { viewRoutes } from './routes/views.js';
import { technitiumRoutes } from './routes/technitium.js';
import { TechnitiumError } from './technitium/client.js';
import { DhcpService } from './technitium/dhcp.js';
import { connectionFromEnv, TechnitiumService } from './technitium/service.js';
import { StatusMonitor } from './status/monitor.js';

export async function buildApp(
  config: AppConfig,
  options: {
    logger?: FastifyServerOptions['logger'];
    startMonitor?: boolean;
    icons?: IconCatalogService;
    /** Ping-Prüfung (Tests ersetzen sie) und ob der Zeitplan startet */
    pinger?: Pinger;
    startScanner?: boolean;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
    // Jede Anfrage zu loggen wäre bei Healthchecks und Live-Updates nur Rauschen.
    disableRequestLogging: process.env.LOG_REQUESTS !== 'true',
  });

  const { db, close } = openDatabase(config.databaseFile, config.migrationsFolder);
  const repo = createRepository(db);
  const authStore = createAuthStore(db);
  const events = new EventHub();
  const monitor = new StatusMonitor({
    intervalMs: config.statusIntervalSeconds * 1000,
    timeoutMs: config.statusTimeoutMs,
    listServices: () => repo.listAllServices(),
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
    if (error instanceof TechnitiumError) {
      if (error.kind !== 'not-configured') request.log.warn({ err: error }, 'Technitium-Fehler');
      return reply.code(error.statusCode).send({ error: error.message, code: error.kind });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
    request.log.error({ err: error }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: 'Interner Serverfehler' });
  });

  await app.register(fastifyCookie);
  registerAuthGuard(app, authStore);
  await app.register(authRoutes, {
    prefix: '/api',
    store: authStore,
    limiter: new LoginRateLimiter(),
    oidc: config.oidc ? createOidc(config.oidc, authStore) : null,
  });
  await app.register(apiRoutes, { prefix: '/api', repo, events, monitor });
  await app.register(viewRoutes, { prefix: '/api', db });
  const icons =
    options.icons ??
    new IconCatalogService({
      cacheFile:
        config.databaseFile === ':memory:'
          ? null
          : join(dirname(config.databaseFile), 'cache', 'icon-catalog.json'),
      onError: (error) => app.log.warn({ err: error }, 'Icon-Verzeichnis nicht abrufbar'),
    });
  await app.register(iconRoutes, { prefix: '/api', icons });
  await app.register(configRoutes, { prefix: '/api', repo, events });
  const audit = createAuditLog(db);
  const technitium = new TechnitiumService({
    db,
    audit,
    envConnection: config.technitium === undefined ? connectionFromEnv() : config.technitium,
  });
  const dhcp = new DhcpService(technitium);
  await app.register(technitiumRoutes, { prefix: '/api', technitium, dhcp, audit });
  const ipam = new IpamRepository(db, audit);
  const ipamHosts = new IpamHostStore(db, audit);
  const ipamUsage = new IpamUsageService(
    {
      scopes: () => dhcp.scopes(),
      leases: () => dhcp.leases(),
      zones: () => technitium.zones(),
      records: (zone) => technitium.records(zone),
    },
    () => ipamHosts.all(),
  );
  // Nach jeder Änderung an DHCP oder DNS die zwischengespeicherte Belegung verwerfen,
  // damit Liste und Seitenfenster sofort den neuen Stand zeigen.
  app.addHook('onResponse', async (request, reply) => {
    if (
      request.method !== 'GET' &&
      request.url.startsWith('/api/technitium/') &&
      reply.statusCode < 400
    )
      ipamUsage.invalidate();
  });
  const scanner = new IpamScanner({
    db,
    audit,
    repo: ipam,
    hosts: ipamHosts,
    ping: options.pinger ?? systemPing,
    onError: (error) => app.log.warn({ err: error }, 'Ping-Prüfung fehlgeschlagen'),
  });
  const ipamSync = new IpamSyncService({ repo: ipam, audit, scopes: () => dhcp.scopes() });
  await app.register(ipamRoutes, {
    prefix: '/api',
    repo: ipam,
    usage: ipamUsage,
    sync: ipamSync,
    scanner,
    hosts: ipamHosts,
  });

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

  const purge = setInterval(() => authStore.purgeExpiredSessions(), 6 * 60 * 60 * 1000);
  purge.unref();
  app.addHook('onReady', async () => {
    authStore.purgeExpiredSessions();
    if (options.startMonitor !== false) monitor.start();
    if (options.startScanner !== false && options.startMonitor !== false) scanner.start();
  });
  app.addHook('onClose', async () => {
    clearInterval(purge);
    monitor.stop();
    scanner.stop();
    close();
  });

  return { app, repo, authStore, monitor, events, technitium, audit, scanner };
}

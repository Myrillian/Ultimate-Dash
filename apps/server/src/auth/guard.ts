import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@ultimate-dash/shared';
import type { AuthStore } from './store.js';
import { SESSION_DAYS } from './store.js';

export const SESSION_COOKIE = 'ud_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionToken: string | null;
  }
}

/** Ohne Anmeldung erreichbar. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/login',
  'POST /api/auth/setup',
  'GET /api/auth/oidc/start',
  'GET /api/auth/oidc/callback',
]);

/** Schreibende Aufrufe, die auch „Nur lesen“-Benutzer für sich selbst machen dürfen. */
const SELF_SERVICE_ROUTES = new Set(['POST /api/auth/logout', 'POST /api/auth/password']);

/**
 * Das Dashboard gehört jedem Benutzer selbst (Gruppen, Services, Import, Kopieren);
 * die Routen arbeiten ausschließlich auf den Daten des angemeldeten Benutzers.
 */
const isOwnDashboardRoute = (route: string) =>
  /^(POST|PUT|DELETE) \/api\/(groups|services)(\/|$)/.test(route) ||
  route === 'POST /api/dashboard/copy' ||
  route === 'POST /api/config/import';

const isWrite = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Hinter einem TLS-Reverse-Proxy (X-Forwarded-Proto: https) als Secure markieren.
    secure: request.protocol === 'https',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Prüft für alle /api-Routen Session, Rolle und Herkunft:
 * - ohne gültige Session → 401
 * - schreibende Aufrufe nur für Admins (außer am eigenen Dashboard) → sonst 403
 * - schreibende Aufrufe von fremden Origins → 403 (CSRF-Schutz zusätzlich zu SameSite)
 */
export function registerAuthGuard(app: FastifyInstance, store: AuthStore) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const route = `${request.method} ${request.routeOptions.url ?? request.url.split('?')[0]}`;

    if (isWrite(request.method) && !sameOrigin(request)) {
      return reply.code(403).send({ error: 'Anfrage von fremder Herkunft abgelehnt' });
    }

    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = store.resolveSession(token);
      if (session) {
        request.user = session.user;
        request.sessionToken = token;
        if (session.renewed) setSessionCookie(request, reply, token);
      } else {
        clearSessionCookie(reply);
      }
    }

    if (PUBLIC_ROUTES.has(route)) return;
    if (!request.user) return reply.code(401).send({ error: 'Nicht angemeldet' });
    if (
      isWrite(request.method) &&
      !SELF_SERVICE_ROUTES.has(route) &&
      !isOwnDashboardRoute(route) &&
      request.user.role !== 'admin'
    ) {
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    }
  });
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  // Kein Origin-Header (z. B. curl, ältere Clients): SameSite-Cookie schützt bereits.
  if (!origin) return true;
  try {
    const forwardedHost = request.headers['x-forwarded-host'];
    const host =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

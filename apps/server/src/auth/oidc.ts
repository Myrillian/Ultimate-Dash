import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as client from 'openid-client';
import { Agent, fetch as undiciFetch } from 'undici';
import type { OidcErrorCode, Role } from '@ultimate-dash/shared';
import { ValidationError } from '../db/repository.js';
import { setSessionCookie } from './guard.js';
import type { AuthStore } from './store.js';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  /** Feste Callback-Adresse; null = aus der Anfrage ableiten (Host + X-Forwarded-*). */
  redirectUri: string | null;
  scopes: string;
  buttonLabel: string;
  groupsClaim: string;
  /** Mitglieder dieser Gruppen werden Admin, alle anderen „Nur lesen“. Leer = Rolle nicht steuern. */
  adminGroups: string[];
  /** Nur Mitglieder dieser Gruppen dürfen sich anmelden. Leer = alle. */
  allowedGroups: string[];
  /** Unbekannte Konten beim ersten Login automatisch anlegen. */
  autoCreate: boolean;
  /** Erstes OIDC-Login mit einem gleichnamigen, noch nicht verknüpften Benutzer verbinden. */
  linkByUsername: boolean;
  /** Selbstsignierte Zertifikate beim Anbieter akzeptieren. */
  tlsInsecure: boolean;
}

const list = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const bool = (raw: string | undefined, fallback: boolean) =>
  raw === undefined || raw === ''
    ? fallback
    : ['1', 'true', 'yes', 'ja'].includes(raw.toLowerCase());

/** Liest die OIDC-Einstellungen aus der Umgebung; null, wenn OIDC nicht eingerichtet ist. */
export function loadOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  if (!issuer && !clientId) return null;
  if (!issuer || !clientId) {
    throw new Error('Für OIDC müssen OIDC_ISSUER und OIDC_CLIENT_ID gesetzt sein');
  }
  return {
    issuer,
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET || null,
    redirectUri: env.OIDC_REDIRECT_URI || null,
    scopes: env.OIDC_SCOPES || 'openid profile email',
    buttonLabel: env.OIDC_BUTTON_LABEL || 'Mit SSO anmelden',
    groupsClaim: env.OIDC_GROUPS_CLAIM || 'groups',
    adminGroups: list(env.OIDC_ADMIN_GROUPS),
    allowedGroups: list(env.OIDC_ALLOWED_GROUPS),
    autoCreate: bool(env.OIDC_AUTO_CREATE, true),
    linkByUsername: bool(env.OIDC_LINK_BY_USERNAME, false),
    tlsInsecure: bool(env.OIDC_TLS_INSECURE, false),
  };
}

export const CALLBACK_PATH = '/api/auth/oidc/callback';
const STATE_COOKIE = 'ud_oidc';
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;

interface Pending {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  expiresAt: number;
}

/** Leitet aus den Claims einen gültigen Benutzernamen ab (Kleinbuchstaben, Ziffern, . _ -). */
export function usernameFromClaims(claims: Record<string, unknown>): string {
  const candidates = [
    claims.preferred_username,
    typeof claims.email === 'string' ? claims.email.split('@')[0] : undefined,
    claims.name,
    claims.sub,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const cleaned = candidate
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34);
    if (cleaned.length >= 3) return cleaned;
    if (cleaned.length > 0) return `user-${cleaned}`;
  }
  return `user-${randomBytes(3).toString('hex')}`;
}

function groupsFrom(claims: Record<string, unknown>, claim: string): string[] {
  const value = claims[claim];
  if (Array.isArray(value)) return value.filter((g): g is string => typeof g === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export function createOidc(config: OidcConfig, store: AuthStore) {
  const pending = new Map<string, Pending>();
  let discovered: Promise<client.Configuration> | null = null;

  function configuration(): Promise<client.Configuration> {
    if (!discovered) {
      const insecureHttp = new URL(config.issuer).protocol === 'http:';
      const dispatcher = config.tlsInsecure
        ? new Agent({ connect: { rejectUnauthorized: false } })
        : undefined;
      const customFetch: client.CustomFetch | undefined = dispatcher
        ? (url, options) =>
            undiciFetch(url, { ...options, dispatcher } as never) as unknown as Promise<Response>
        : undefined;
      discovered = client
        .discovery(
          new URL(config.issuer),
          config.clientId,
          config.clientSecret ?? undefined,
          config.clientSecret ? undefined : client.None(),
          {
            execute: insecureHttp ? [client.allowInsecureRequests] : [],
            // Wird für alle späteren Anfragen dieser Konfiguration übernommen.
            ...(customFetch ? { [client.customFetch]: customFetch } : {}),
          },
        )
        .catch((error: unknown) => {
          // Beim nächsten Versuch erneut abfragen, statt den Fehler dauerhaft zu merken.
          discovered = null;
          throw error;
        });
    }
    return discovered;
  }

  function redirectUriFor(request: FastifyRequest): string {
    return config.redirectUri ?? `${request.protocol}://${request.host}${CALLBACK_PATH}`;
  }

  function cleanup() {
    const now = Date.now();
    for (const [key, value] of pending) if (value.expiresAt <= now) pending.delete(key);
    // Schutz gegen massenhaft angestoßene, nie abgeschlossene Anmeldungen.
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  }

  /** Ermittelt Rolle und Benutzer zu den Claims; wirft OidcLoginError bei fehlendem Zugriff. */
  function resolveUser(claims: Record<string, unknown>, log: FastifyRequest['log']) {
    const subject = String(claims.sub);
    const groups = groupsFrom(claims, config.groupsClaim);
    if (config.allowedGroups.length > 0 && !groups.some((g) => config.allowedGroups.includes(g))) {
      throw new OidcLoginError('forbidden', 'Nicht in einer der erlaubten Gruppen');
    }
    const roleFromGroups: Role | null =
      config.adminGroups.length === 0
        ? null
        : groups.some((g) => config.adminGroups.includes(g))
          ? 'admin'
          : 'viewer';

    let row = store.findByOidcSubject(subject);
    const preferred = usernameFromClaims(claims);
    if (!row && config.linkByUsername) {
      const existing = store.findByUsername(preferred);
      if (existing && !existing.oidcSubject) {
        store.updateUser(existing.id, { oidcSubject: subject });
        row = store.getUser(existing.id);
        log.info({ username: existing.username }, 'OIDC-Identität mit Benutzer verknüpft');
      }
    }
    if (!row) {
      if (!config.autoCreate) throw new OidcLoginError('unknown_user', 'Kein Benutzer verknüpft');
      row = store.createOidcUser(preferred, subject, roleFromGroups ?? 'viewer');
      log.info({ username: row.username, role: row.role }, 'Benutzer über OIDC angelegt');
    } else if (roleFromGroups && row.role !== roleFromGroups) {
      try {
        store.updateUser(row.id, { role: roleFromGroups });
        row = store.getUser(row.id);
      } catch (error) {
        // Der letzte Admin wird nicht durch eine Gruppenänderung beim Anbieter ausgesperrt.
        if (!(error instanceof ValidationError)) throw error;
        log.warn({ username: row.username }, 'Rolle nicht geändert: letzter Admin');
      }
    }
    return row;
  }

  async function routes(app: FastifyInstance) {
    const fail = (reply: FastifyReply, code: OidcErrorCode) =>
      reply.redirect(`/?login_error=${code}`, 303);

    app.get('/auth/oidc/start', async (request, reply) => {
      if (store.userCount() === 0) return fail(reply, 'setup');
      let oidc: client.Configuration;
      try {
        oidc = await configuration();
      } catch (error) {
        request.log.error({ err: error }, 'OIDC-Anbieter nicht erreichbar');
        return fail(reply, 'unavailable');
      }
      cleanup();
      const state = client.randomState();
      const codeVerifier = client.randomPKCECodeVerifier();
      const nonce = client.randomNonce();
      const redirectUri = redirectUriFor(request);
      pending.set(state, {
        codeVerifier,
        nonce,
        redirectUri,
        expiresAt: Date.now() + STATE_TTL_MS,
      });

      // Bindet die Anmeldung an diesen Browser: ohne Cookie kein gültiger Callback.
      reply.setCookie(STATE_COOKIE, state, {
        path: '/api/auth/oidc',
        httpOnly: true,
        sameSite: 'lax',
        secure: request.protocol === 'https',
        maxAge: STATE_TTL_MS / 1000,
      });
      const url = client.buildAuthorizationUrl(oidc, {
        redirect_uri: redirectUri,
        scope: config.scopes,
        state,
        nonce,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      });
      return reply.redirect(url.href, 303);
    });

    app.get('/auth/oidc/callback', async (request, reply) => {
      const state = request.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oidc' });
      const query = request.query as Record<string, string | undefined>;
      if (query.error) {
        request.log.warn(
          { error: query.error, description: query.error_description },
          'OIDC abgelehnt',
        );
        return fail(reply, 'provider');
      }
      const entry = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      if (!state || !entry || entry.expiresAt <= Date.now() || query.state !== state) {
        return fail(reply, 'state');
      }

      try {
        const oidc = await configuration();
        const currentUrl = new URL(entry.redirectUri);
        currentUrl.search = new URL(request.url, 'http://localhost').search;
        const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
          pkceCodeVerifier: entry.codeVerifier,
          expectedNonce: entry.nonce,
          expectedState: state,
          idTokenExpected: true,
        });
        let claims: Record<string, unknown> = { ...tokens.claims() };
        // Gruppen stehen bei manchen Anbietern nur im Userinfo-Endpunkt.
        if (!(config.groupsClaim in claims) && tokens.access_token) {
          try {
            const info = await client.fetchUserInfo(oidc, tokens.access_token, String(claims.sub));
            claims = { ...info, ...claims };
          } catch (error) {
            request.log.debug({ err: error }, 'Userinfo nicht abrufbar');
          }
        }

        const row = resolveUser(claims, request.log);
        store.markLogin(row.id);
        setSessionCookie(
          request,
          reply,
          store.createSession(row.id, request.headers['user-agent']),
        );
        request.log.info({ username: row.username }, 'OIDC-Anmeldung');
        return reply.redirect('/', 303);
      } catch (error) {
        if (error instanceof OidcLoginError) {
          request.log.warn({ reason: error.message }, 'OIDC-Anmeldung verweigert');
          return fail(reply, error.code);
        }
        request.log.error({ err: error }, 'OIDC-Anmeldung fehlgeschlagen');
        return fail(reply, 'provider');
      }
    });
  }

  return {
    status: { label: config.buttonLabel, rolesFromGroups: config.adminGroups.length > 0 },
    routes,
  };
}

export class OidcLoginError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type Oidc = ReturnType<typeof createOidc>;

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import type { AuthStatus } from '@ultimate-dash/shared';
import { buildApp } from '../app.js';
import type { AppConfig } from '../config.js';
import { loadOidcConfig, usernameFromClaims, type OidcConfig } from './oidc.js';

/**
 * Minimaler OIDC-Anbieter für Tests: Discovery, Authorize (ohne Login-Maske),
 * Token mit PKCE-Prüfung, JWKS und Userinfo.
 */
class FakeProvider {
  server!: Server;
  issuer = '';
  /** Claims für die nächste Anmeldung */
  claims: Record<string, unknown> = {};
  private codes = new Map<string, { nonce: string; challenge: string; claims: object }>();
  private key!: CryptoKey;
  private jwk!: object;

  async start() {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.key = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  /** Simuliert den Browser beim Anbieter und liefert die Callback-Adresse. */
  authorize(location: string): URL {
    const url = new URL(location);
    const code = randomBytes(8).toString('hex');
    this.codes.set(code, {
      nonce: url.searchParams.get('nonce')!,
      challenge: url.searchParams.get('code_challenge')!,
      claims: this.claims,
    });
    const back = new URL(url.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state')!);
    return back;
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) {
    const json = (status: number, body: object) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        userinfo_endpoint: `${this.issuer}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (req.url === '/jwks') return json(200, { keys: [this.jwk] });
    if (req.url === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = new URLSearchParams(raw);
      const entry = this.codes.get(body.get('code') ?? '');
      this.codes.delete(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!entry || entry.challenge !== challenge) return json(400, { error: 'invalid_grant' });
      const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(this.issuer)
        .setAudience('dash')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.key);
      return json(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken });
    }
    json(404, { error: 'not_found' });
  }
}

const provider = new FakeProvider();
beforeAll(() => provider.start());
afterAll(() => provider.stop());

const PASSWORD = 'ein-langes-passwort';
const REDIRECT = 'http://dash.test/api/auth/oidc/callback';

function oidcConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer: provider.issuer,
    clientId: 'dash',
    clientSecret: 'geheim',
    redirectUri: REDIRECT,
    scopes: 'openid profile email',
    buttonLabel: 'Mit Authentik anmelden',
    groupsClaim: 'groups',
    adminGroups: [],
    allowedGroups: [],
    autoCreate: true,
    linkByUsername: false,
    tlsInsecure: false,
    ...overrides,
  };
}

let ctx: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function start(overrides: Partial<OidcConfig> = {}, withAdmin = true) {
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    databaseFile: ':memory:',
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    webRoot: null,
    statusIntervalSeconds: 60,
    statusTimeoutMs: 1000,
    logLevel: 'silent',
    oidc: oidcConfig(overrides),
  };
  ctx = await buildApp(config, { logger: false, startMonitor: false });
  if (withAdmin) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
  }
  return ctx;
}

const cookieValue = (setCookie: unknown, name: string) => {
  const all = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  const hit = all.find((c: string) => c.startsWith(`${name}=`));
  return hit?.split(';')[0];
};

/** Kompletter Ablauf: Start → Anbieter → Callback. Liefert Ziel und Session-Cookie. */
async function login(claims: Record<string, unknown>) {
  provider.claims = claims;
  const app = ctx!.app;
  const startRes = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
  expect(startRes.statusCode).toBe(303);
  const stateCookie = cookieValue(startRes.headers['set-cookie'], 'ud_oidc');
  const back = provider.authorize(String(startRes.headers.location));
  const res = await app.inject({
    method: 'GET',
    url: back.pathname + back.search,
    headers: stateCookie ? { cookie: stateCookie } : {},
  });
  return {
    location: String(res.headers.location),
    session: cookieValue(res.headers['set-cookie'], 'ud_session'),
  };
}

async function status(session: string | undefined): Promise<AuthStatus> {
  const res = await ctx!.app.inject({
    method: 'GET',
    url: '/api/auth/status',
    headers: session ? { cookie: session } : {},
  });
  return res.json();
}

describe('OIDC-Konfiguration', () => {
  it('ist ohne Variablen aus und verlangt Issuer und Client-ID gemeinsam', () => {
    expect(loadOidcConfig({})).toBeNull();
    expect(() => loadOidcConfig({ OIDC_ISSUER: 'https://sso.example' })).toThrow();
    const config = loadOidcConfig({
      OIDC_ISSUER: 'https://sso.example',
      OIDC_CLIENT_ID: 'dash',
      OIDC_ADMIN_GROUPS: 'admins, homelab-admins',
      OIDC_AUTO_CREATE: 'false',
    });
    expect(config?.adminGroups).toEqual(['admins', 'homelab-admins']);
    expect(config?.autoCreate).toBe(false);
    expect(config?.scopes).toBe('openid profile email');
  });

  it('leitet gültige Benutzernamen aus den Claims ab', () => {
    expect(usernameFromClaims({ preferred_username: 'Jürgen Groß' })).toBe('jurgen-gross');
    expect(usernameFromClaims({ email: 'anna@example.org', sub: 'x' })).toBe('anna');
    expect(usernameFromClaims({ preferred_username: 'al' })).toBe('user-al');
    expect(usernameFromClaims({ sub: '0a1b2c3d' })).toBe('0a1b2c3d');
  });
});

describe('OIDC-Anmeldung', () => {
  it('meldet den Anbieter im Status und legt unbekannte Benutzer als „Nur lesen“ an', async () => {
    await start();
    expect((await status(undefined)).oidc).toEqual({
      label: 'Mit Authentik anmelden',
      rolesFromGroups: false,
    });

    const result = await login({ sub: 'u-1', preferred_username: 'Anna' });
    expect(result.location).toBe('/');
    expect(result.session).toBeDefined();
    const { user } = await status(result.session);
    expect(user).toMatchObject({
      username: 'anna',
      role: 'viewer',
      oidc: true,
      hasPassword: false,
    });

    // Zweite Anmeldung findet denselben Benutzer über „sub“, auch wenn sich der Name ändert.
    const again = await login({ sub: 'u-1', preferred_username: 'anna.neu' });
    expect((await status(again.session)).user?.id).toBe(user?.id);
  });

  it('steuert die Rolle über Gruppen und sperrt den letzten Admin nicht aus', async () => {
    await start({ adminGroups: ['admins'] });
    const first = await login({ sub: 'u-2', preferred_username: 'ben', groups: ['admins'] });
    expect((await status(first.session)).user?.role).toBe('admin');

    const second = await login({ sub: 'u-2', preferred_username: 'ben', groups: ['users'] });
    expect((await status(second.session)).user?.role).toBe('viewer');

    // Ist ben der einzige Admin, bleibt er es trotz fehlender Gruppe.
    await login({ sub: 'u-2', preferred_username: 'ben', groups: ['admins'] });
    ctx!.authStore.deleteUser(ctx!.authStore.findByUsername('admin')!.id);
    const third = await login({ sub: 'u-2', preferred_username: 'ben', groups: [] });
    expect((await status(third.session)).user?.role).toBe('admin');
  });

  it('lässt nur erlaubte Gruppen hinein', async () => {
    await start({ allowedGroups: ['dashboard'] });
    const denied = await login({ sub: 'u-3', preferred_username: 'carl', groups: ['other'] });
    expect(denied.location).toBe('/?login_error=forbidden');
    expect(denied.session).toBeUndefined();

    const allowed = await login({ sub: 'u-3', preferred_username: 'carl', groups: 'dashboard' });
    expect(allowed.location).toBe('/');
  });

  it('legt ohne automatisches Anlegen keine Benutzer an', async () => {
    await start({ autoCreate: false });
    const result = await login({ sub: 'u-4', preferred_username: 'dora' });
    expect(result.location).toBe('/?login_error=unknown_user');
  });

  it('verknüpft gleichnamige lokale Benutzer nur, wenn es eingeschaltet ist', async () => {
    await start();
    const separate = await login({ sub: 'u-5', preferred_username: 'admin' });
    expect((await status(separate.session)).user).toMatchObject({ username: 'admin-2' });

    await ctx!.app.close();
    await start({ linkByUsername: true });
    const linked = await login({ sub: 'u-6', preferred_username: 'admin' });
    expect((await status(linked.session)).user).toMatchObject({
      username: 'admin',
      role: 'admin',
      oidc: true,
      hasPassword: true,
    });
  });

  it('weist Callbacks ohne passenden State ab', async () => {
    await start();
    provider.claims = { sub: 'u-7' };
    const startRes = await ctx!.app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
    const back = provider.authorize(String(startRes.headers.location));
    // Ohne State-Cookie, z. B. wenn ein fremder Link den Callback auslöst
    const res = await ctx!.app.inject({ method: 'GET', url: back.pathname + back.search });
    expect(res.headers.location).toBe('/?login_error=state');
  });

  it('leitet Ablehnungen des Anbieters zur Anmeldung zurück', async () => {
    await start();
    const res = await ctx!.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?error=access_denied',
    });
    expect(res.headers.location).toBe('/?login_error=provider');
  });

  it('verlangt zuerst die lokale Ersteinrichtung', async () => {
    await start({}, false);
    const res = await ctx!.app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
    expect(res.headers.location).toBe('/?login_error=setup');
  });

  it('erlaubt OIDC-Benutzern keine Passwortänderung', async () => {
    await start();
    const { session } = await login({ sub: 'u-8', preferred_username: 'emil' });
    const res = await ctx!.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: session! },
      payload: { currentPassword: 'egal', newPassword: 'ein-neues-passwort' },
    });
    expect(res.statusCode).toBe(400);
  });
});

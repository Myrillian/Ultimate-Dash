import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  emailChangeInput,
  forgotPasswordInput,
  loginInput,
  passwordChangeInput,
  resetCheckInput,
  resetPasswordInput,
  RESET_PATH,
  type ResetLink,
  setupInput,
  userCreateInput,
  userUpdateInput,
  type AuthStatus,
} from '@ultimate-dash/shared';
import { ValidationError } from '../db/repository.js';
import { clearSessionCookie, setSessionCookie } from './guard.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import type { Mailer } from './mailer.js';
import { LoginRateLimiter } from './rate-limit.js';
import type { Oidc } from './oidc.js';
import { toUser, type AuthStore } from './store.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const resetMailText = (username: string, link: string) =>
  [
    `Hallo ${username},`,
    '',
    'für dein Konto bei Ultimate Dash wurde ein neues Passwort angefordert.',
    'Über diesen Link kannst du es innerhalb der nächsten Stunde festlegen:',
    '',
    link,
    '',
    'Wenn du das nicht warst, ignoriere diese Mail einfach. Dein bisheriges Passwort bleibt gültig.',
  ].join('\n');

export async function authRoutes(
  app: FastifyInstance,
  {
    store,
    limiter,
    oidc,
    mail = null,
  }: {
    store: AuthStore;
    limiter: LoginRateLimiter;
    oidc: Oidc | null;
    /** Liefert Versand und Link-Adresse, solange ein Mailserver eingerichtet ist. */
    mail?: { current(): { mailer: Mailer; publicUrl: string } | null } | null;
  },
) {
  // „Passwort vergessen“ ohne Anmeldung: pro IP und pro Konto begrenzen (kein Mail-Bombing).
  const forgotPerIp = new LoginRateLimiter(10, 15 * 60 * 1000);
  const forgotPerUser = new LoginRateLimiter(3, 60 * 60 * 1000);

  if (oidc) await app.register(oidc.routes);

  app.get('/auth/status', async (request): Promise<AuthStatus> => ({
    setupRequired: store.userCount() === 0,
    user: request.user,
    oidc: oidc?.status ?? null,
    passwordResetMail: mail?.current() != null,
  }));

  app.post('/auth/setup', async (request, reply) => {
    const { username, password } = setupInput.parse(request.body);
    const user = store.createFirstAdmin(username, await hashPassword(password));
    if (!user)
      return reply.code(409).send({ error: 'Die Einrichtung wurde bereits abgeschlossen' });
    store.markLogin(user.id);
    setSessionCookie(request, reply, store.createSession(user.id, request.headers['user-agent']));
    request.log.info({ username }, 'Ersteinrichtung abgeschlossen');
    return reply.code(201).send(user);
  });

  app.post('/auth/login', async (request, reply) => {
    const { username, password } = loginInput.parse(request.body);
    const key = `${request.ip}|${username}`;
    const wait = limiter.retryAfter(key);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(wait))
        .send({
          error: `Zu viele Fehlversuche. Bitte in ${Math.ceil(wait / 60)} Minuten erneut versuchen.`,
        });
    }

    const row = store.findByUsername(username);
    const valid = row?.passwordHash ? await verifyPassword(password, row.passwordHash) : false;
    if (!row?.passwordHash) await burnPasswordCheck(password);
    if (!row || !valid) {
      limiter.fail(key);
      // Für fail2ban/CrowdSec auswertbar
      request.log.warn({ username, ip: request.ip }, 'Fehlgeschlagener Login');
      return reply.code(401).send({ error: 'Benutzername oder Passwort ist falsch' });
    }

    limiter.reset(key);
    store.markLogin(row.id);
    setSessionCookie(request, reply, store.createSession(row.id, request.headers['user-agent']));
    return toUser({ ...row, lastLoginAt: new Date().toISOString() });
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.sessionToken) store.deleteSession(request.sessionToken);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.post('/auth/password', async (request, reply) => {
    const { currentPassword, newPassword } = passwordChangeInput.parse(request.body);
    const row = store.getUser(request.user!.id);
    if (!row.passwordHash) {
      throw new ValidationError('Dieses Konto meldet sich über OIDC an und hat kein Passwort');
    }
    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new ValidationError('Das aktuelle Passwort ist falsch');
    }
    store.updateUser(row.id, { passwordHash: await hashPassword(newPassword) });
    // Andere Geräte abmelden, diese Sitzung bleibt bestehen.
    store.deleteUserSessions(row.id, request.sessionToken ?? undefined);
    return reply.code(204).send();
  });

  app.put('/auth/email', async (request) => {
    const { email } = emailChangeInput.parse(request.body);
    return store.updateUser(request.user!.id, { email });
  });

  /**
   * Antwortet immer gleich, egal ob es das Konto gibt, damit sich so keine Benutzernamen
   * oder Adressen ausforschen lassen. Mit Mailversand geht der Link an die hinterlegte
   * Adresse, sonst sehen Admins die Anfrage in der Benutzerverwaltung.
   */
  app.post('/auth/forgot', async (request, reply) => {
    const { login } = forgotPasswordInput.parse(request.body);
    const wait = forgotPerIp.retryAfter(request.ip);
    if (wait > 0) {
      return reply
        .code(429)
        .header('retry-after', String(wait))
        .send({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    }
    forgotPerIp.fail(request.ip);

    const row = store.findByLogin(login);
    // Nur Konten mit lokalem Passwort; reine SSO-Konten setzen es beim Anbieter zurück.
    if (row?.passwordHash && forgotPerUser.retryAfter(String(row.id)) === 0) {
      forgotPerUser.fail(String(row.id));
      const mailer = mail?.current() ?? null;
      if (mailer && row.email) {
        const { token } = store.createPasswordReset(row.id, 'mail');
        const link = `${mailer.publicUrl}${RESET_PATH}#token=${token}`;
        // Nicht abwarten: die Antwortzeit soll nicht verraten, ob eine Mail rausging.
        mailer.mailer
          .send({
            to: row.email,
            subject: 'Ultimate Dash: Passwort zurücksetzen',
            text: resetMailText(row.username, link),
          })
          .then(() => request.log.info({ username: row.username }, 'Reset-Mail verschickt'))
          .catch((error: unknown) =>
            request.log.error({ err: error, username: row.username }, 'Reset-Mail fehlgeschlagen'),
          );
      } else {
        store.markResetRequested(row.id);
        request.log.info({ username: row.username }, 'Passwort-Reset beim Admin angefragt');
      }
    } else {
      request.log.info({ login, ip: request.ip }, 'Passwort-Reset ohne passendes Konto');
    }
    return reply.code(202).send({ ok: true });
  });

  app.post('/auth/reset/check', async (request) => {
    const { token } = resetCheckInput.parse(request.body);
    const row = store.resolvePasswordReset(token);
    if (!row) throw new ValidationError('Der Link ist ungültig oder abgelaufen');
    return { username: row.username };
  });

  app.post('/auth/reset', async (request, reply) => {
    const { token, password } = resetPasswordInput.parse(request.body);
    const row = store.resolvePasswordReset(token);
    if (!row) throw new ValidationError('Der Link ist ungültig oder abgelaufen');
    // updateUser entwertet dabei alle Reset-Links des Benutzers.
    store.updateUser(row.id, { passwordHash: await hashPassword(password) });
    store.deleteUserSessions(row.id);
    store.markLogin(row.id);
    setSessionCookie(request, reply, store.createSession(row.id, request.headers['user-agent']));
    request.log.info({ username: row.username }, 'Passwort über Reset-Link neu gesetzt');
    return toUser(store.getUser(row.id));
  });

  // Benutzerverwaltung (nur Admin; Schreibschutz kommt aus dem Guard)
  app.get('/users', async (request, reply) => {
    if (request.user!.role !== 'admin')
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    return store.listUsers();
  });

  app.post('/users', async (request, reply) => {
    const { username, password, role, email } = userCreateInput.parse(request.body);
    const user = store.createUser(username, await hashPassword(password), role, email ?? null);
    return reply.code(201).send(user);
  });

  app.put('/users/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const { role, password, email } = userUpdateInput.parse(request.body);
    if (id === request.user!.id && role && role !== 'admin') {
      throw new ValidationError('Du kannst dir die Admin-Rolle nicht selbst entziehen');
    }
    const user = store.updateUser(id, {
      ...(role ? { role } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
      ...(email !== undefined ? { email } : {}),
    });
    // Nach Rollen- oder Passwortänderung muss sich der Benutzer neu anmelden.
    if (id !== request.user!.id && (role || password)) store.deleteUserSessions(id);
    return user;
  });

  /** Erzeugt einen Reset-Link, den der Admin dem Benutzer selbst weitergibt (24 Stunden gültig). */
  app.post('/users/:id/reset-link', async (request, reply): Promise<ResetLink> => {
    const { id } = idParam.parse(request.params);
    if (id === request.user!.id)
      throw new ValidationError('Dein eigenes Passwort änderst du über „Passwort ändern“');
    const user = store.getUser(id);
    const link = store.createPasswordReset(user.id, 'admin');
    request.log.info({ username: user.username, by: request.user!.username }, 'Reset-Link erzeugt');
    return reply.code(201).send(link);
  });

  app.delete('/users/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (id === request.user!.id) throw new ValidationError('Du kannst dich nicht selbst löschen');
    store.deleteUser(id);
    return reply.code(204).send();
  });
}

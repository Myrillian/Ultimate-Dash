import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  loginInput,
  passwordChangeInput,
  setupInput,
  userCreateInput,
  userUpdateInput,
  type AuthStatus,
} from '@ultimate-dash/shared';
import { ValidationError } from '../db/repository.js';
import { clearSessionCookie, setSessionCookie } from './guard.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import type { LoginRateLimiter } from './rate-limit.js';
import { toUser, type AuthStore } from './store.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function authRoutes(
  app: FastifyInstance,
  { store, limiter }: { store: AuthStore; limiter: LoginRateLimiter },
) {
  app.get('/auth/status', async (request): Promise<AuthStatus> => ({
    setupRequired: store.userCount() === 0,
    user: request.user,
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
    if (!row.passwordHash || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new ValidationError('Das aktuelle Passwort ist falsch');
    }
    store.updateUser(row.id, { passwordHash: await hashPassword(newPassword) });
    // Andere Geräte abmelden, diese Sitzung bleibt bestehen.
    store.deleteUserSessions(row.id, request.sessionToken ?? undefined);
    return reply.code(204).send();
  });

  // Benutzerverwaltung (nur Admin; Schreibschutz kommt aus dem Guard)
  app.get('/users', async (request, reply) => {
    if (request.user!.role !== 'admin')
      return reply.code(403).send({ error: 'Dafür sind Admin-Rechte nötig' });
    return store.listUsers();
  });

  app.post('/users', async (request, reply) => {
    const { username, password, role } = userCreateInput.parse(request.body);
    const user = store.createUser(username, await hashPassword(password), role);
    return reply.code(201).send(user);
  });

  app.put('/users/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const { role, password } = userUpdateInput.parse(request.body);
    if (id === request.user!.id && role && role !== 'admin') {
      throw new ValidationError('Du kannst dir die Admin-Rolle nicht selbst entziehen');
    }
    const user = store.updateUser(id, {
      ...(role ? { role } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    });
    // Nach Rollen- oder Passwortänderung muss sich der Benutzer neu anmelden.
    if (id !== request.user!.id) store.deleteUserSessions(id);
    return user;
  });

  app.delete('/users/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (id === request.user!.id) throw new ValidationError('Du kannst dich nicht selbst löschen');
    store.deleteUser(id);
    return reply.code(204).send();
  });
}

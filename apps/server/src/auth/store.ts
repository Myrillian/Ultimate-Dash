import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, lt, ne, or } from 'drizzle-orm';
import type { Role, User } from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import { NotFoundError, ValidationError } from '../db/repository.js';
import { passwordResets, sessions, users } from '../db/schema.js';

export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Gültigkeit von Reset-Links: per Mail kurz, vom Admin oder per Kommandozeile länger. */
export const RESET_TTL_MS = { mail: HOUR_MS, admin: 24 * HOUR_MS, cli: 24 * HOUR_MS } as const;
export type ResetSource = keyof typeof RESET_TTL_MS;

type UserRow = typeof users.$inferSelect;

export const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  role: row.role,
  createdAt: row.createdAt,
  lastLoginAt: row.lastLoginAt,
  hasPassword: row.passwordHash !== null,
  oidc: row.oidcSubject !== null,
  email: row.email,
  resetRequestedAt: row.resetRequestedAt,
});

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
const expiry = () => new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString();

export function createAuthStore(db: Db) {
  return {
    userCount(): number {
      return db.select({ value: count() }).from(users).get()?.value ?? 0;
    },

    findByUsername(username: string): UserRow | undefined {
      return db.select().from(users).where(eq(users.username, username)).get();
    },

    /** Sucht für „Passwort vergessen“ nach Benutzername oder E-Mail-Adresse. */
    findByLogin(login: string): UserRow | undefined {
      return db
        .select()
        .from(users)
        .where(or(eq(users.username, login), eq(users.email, login)))
        .get();
    },

    findByOidcSubject(subject: string): UserRow | undefined {
      return db.select().from(users).where(eq(users.oidcSubject, subject)).get();
    },

    /** Legt einen OIDC-Benutzer ohne Passwort an; bei Namensgleichheit mit Zähler (anna-2). */
    createOidcUser(preferredName: string, subject: string, role: Role): UserRow {
      let username = preferredName;
      for (let n = 2; this.findByUsername(username); n++) username = `${preferredName}-${n}`;
      return db
        .insert(users)
        .values({ username, passwordHash: null, oidcSubject: subject, role })
        .returning()
        .get();
    },

    getUser(id: number): UserRow {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row) throw new NotFoundError('Benutzer');
      return row;
    },

    listUsers(): User[] {
      return db.select().from(users).orderBy(users.username).all().map(toUser);
    },

    createUser(
      username: string,
      passwordHash: string,
      role: Role,
      email: string | null = null,
    ): User {
      if (this.findByUsername(username))
        throw new ValidationError('Benutzername ist bereits vergeben');
      if (email) this.assertEmailFree(email);
      return toUser(
        db.insert(users).values({ username, passwordHash, role, email }).returning().get(),
      );
    },

    assertEmailFree(email: string, exceptId?: number): void {
      const other = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
      if (other && other.id !== exceptId)
        throw new ValidationError('Diese E-Mail-Adresse gehört schon zu einem anderen Benutzer');
    },

    /** Legt den ersten Admin an; schlägt fehl, wenn schon jemand existiert (atomar). */
    createFirstAdmin(username: string, passwordHash: string): User | null {
      return db.transaction((tx) => {
        const existing = tx.select({ value: count() }).from(users).get()?.value ?? 0;
        if (existing > 0) return null;
        return toUser(
          tx.insert(users).values({ username, passwordHash, role: 'admin' }).returning().get(),
        );
      });
    },

    updateUser(
      id: number,
      changes: {
        role?: Role;
        passwordHash?: string | null;
        oidcSubject?: string | null;
        email?: string | null;
        resetRequestedAt?: string | null;
      },
    ): User {
      const current = this.getUser(id);
      if (changes.role && changes.role !== 'admin' && current.role === 'admin')
        this.assertOtherAdmin(id);
      if (changes.email) this.assertEmailFree(changes.email, id);
      // Ein neues Passwort erledigt eine offene Anfrage und macht alte Reset-Links ungültig.
      if (changes.passwordHash !== undefined) {
        changes = { ...changes, resetRequestedAt: null };
        db.delete(passwordResets).where(eq(passwordResets.userId, id)).run();
      }
      const row = db.update(users).set(changes).where(eq(users.id, id)).returning().get();
      return toUser(row!);
    },

    deleteUser(id: number): void {
      const current = this.getUser(id);
      if (current.role === 'admin') this.assertOtherAdmin(id);
      db.delete(users).where(eq(users.id, id)).run();
    },

    assertOtherAdmin(id: number): void {
      const others =
        db
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.role, 'admin'), ne(users.id, id)))
          .get()?.value ?? 0;
      if (others === 0) throw new ValidationError('Es muss mindestens ein Admin bestehen bleiben');
    },

    markLogin(id: number): void {
      db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, id)).run();
    },

    /** Erzeugt eine Session und gibt das Token für das Cookie zurück. */
    createSession(userId: number, userAgent: string | undefined): string {
      const token = randomBytes(32).toString('base64url');
      db.insert(sessions)
        .values({
          id: hashToken(token),
          userId,
          expiresAt: expiry(),
          userAgent: userAgent?.slice(0, 200) ?? null,
        })
        .run();
      return token;
    },

    /** Liefert den Benutzer zur Session und verlängert sie bei Nutzung (gleitender Ablauf). */
    resolveSession(token: string): { user: User; renewed: boolean } | null {
      const id = hashToken(token);
      const row = db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, id))
        .get();
      if (!row) return null;
      const expiresAt = Date.parse(row.session.expiresAt);
      if (expiresAt <= Date.now()) {
        db.delete(sessions).where(eq(sessions.id, id)).run();
        return null;
      }
      // Höchstens einmal pro Tag schreiben, nicht bei jeder Anfrage.
      const renewed = expiresAt - Date.now() < (SESSION_DAYS - 1) * DAY_MS;
      if (renewed)
        db.update(sessions).set({ expiresAt: expiry() }).where(eq(sessions.id, id)).run();
      return { user: toUser(row.user), renewed };
    },

    deleteSession(token: string): void {
      db.delete(sessions)
        .where(eq(sessions.id, hashToken(token)))
        .run();
    },

    /** Meldet einen Benutzer überall ab, optional außer der aktuellen Session. */
    deleteUserSessions(userId: number, exceptToken?: string): void {
      const condition = exceptToken
        ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(exceptToken)))
        : eq(sessions.userId, userId);
      db.delete(sessions).where(condition).run();
    },

    purgeExpiredSessions(): void {
      const now = new Date().toISOString();
      db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
      db.delete(passwordResets).where(lt(passwordResets.expiresAt, now)).run();
    },

    /**
     * Erzeugt einen Einmal-Link zum Zurücksetzen des Passworts. Ältere Links desselben
     * Benutzers werden dabei ungültig, damit immer nur der neueste funktioniert.
     */
    createPasswordReset(userId: number, source: ResetSource): { token: string; expiresAt: string } {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + RESET_TTL_MS[source]).toISOString();
      db.transaction((tx) => {
        tx.delete(passwordResets).where(eq(passwordResets.userId, userId)).run();
        tx.insert(passwordResets)
          .values({ id: hashToken(token), userId, expiresAt, source })
          .run();
      });
      return { token, expiresAt };
    },

    /** Liefert den Benutzer zu einem noch gültigen Reset-Token, sonst null. */
    resolvePasswordReset(token: string): UserRow | null {
      const row = db
        .select({ reset: passwordResets, user: users })
        .from(passwordResets)
        .innerJoin(users, eq(users.id, passwordResets.userId))
        .where(eq(passwordResets.id, hashToken(token)))
        .get();
      if (!row) return null;
      if (Date.parse(row.reset.expiresAt) <= Date.now()) {
        db.delete(passwordResets)
          .where(eq(passwordResets.id, hashToken(token)))
          .run();
        return null;
      }
      return row.user;
    },

    markResetRequested(userId: number): void {
      db.update(users)
        .set({ resetRequestedAt: new Date().toISOString() })
        .where(eq(users.id, userId))
        .run();
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;

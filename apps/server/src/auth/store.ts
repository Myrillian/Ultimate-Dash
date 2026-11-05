import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, lt, ne } from 'drizzle-orm';
import type { Role, User } from '@ultimate-dash/shared';
import type { Db } from '../db/client.js';
import { NotFoundError, ValidationError } from '../db/repository.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type UserRow = typeof users.$inferSelect;

export const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  role: row.role,
  createdAt: row.createdAt,
  lastLoginAt: row.lastLoginAt,
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

    getUser(id: number): UserRow {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row) throw new NotFoundError('Benutzer');
      return row;
    },

    listUsers(): User[] {
      return db.select().from(users).orderBy(users.username).all().map(toUser);
    },

    createUser(username: string, passwordHash: string, role: Role): User {
      if (this.findByUsername(username))
        throw new ValidationError('Benutzername ist bereits vergeben');
      return toUser(db.insert(users).values({ username, passwordHash, role }).returning().get());
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

    updateUser(id: number, changes: { role?: Role; passwordHash?: string }): User {
      const current = this.getUser(id);
      if (changes.role && changes.role !== 'admin' && current.role === 'admin')
        this.assertOtherAdmin(id);
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
      db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;

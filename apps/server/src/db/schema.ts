import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon'),
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const services = sqliteTable(
  'services',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    description: text('description'),
    icon: text('icon'),
    target: text('target', { enum: ['_blank', '_self'] })
      .notNull()
      .default('_blank'),
    statusCheck: integer('status_check', { mode: 'boolean' }).notNull().default(true),
    statusUrl: text('status_url'),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [index('services_group_idx').on(table.groupId, table.sortOrder)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** null bei Benutzern, die sich nur über OIDC anmelden. */
  passwordHash: text('password_hash'),
  /** „sub“-Claim des OIDC-Anbieters; verknüpft das Konto dauerhaft mit der Identität dort. */
  oidcSubject: text('oidc_subject').unique(),
  role: text('role', { enum: ['admin', 'viewer'] })
    .notNull()
    .default('viewer'),
  createdAt: timestamps.createdAt,
  lastLoginAt: text('last_login_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 des Tokens; das Token selbst steht nur im Cookie. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: timestamps.createdAt,
    userAgent: text('user_agent'),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

export const groups = sqliteTable(
  'groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Besitzer des Dashboards; null nur bei Altbestand ohne Benutzer (wird beim ersten Admin eingesammelt). */
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [index('groups_user_idx').on(table.userId, table.sortOrder)],
);

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
  /** Für „Passwort vergessen“ per E-Mail; optional. */
  email: text('email').unique(),
  /** „Passwort vergessen“ wurde angefragt, aber keine Mail war möglich; Admins sehen den Hinweis. */
  resetRequestedAt: text('reset_requested_at'),
  createdAt: timestamps.createdAt,
  lastLoginAt: text('last_login_at'),
});

/** Einmal-Tokens für das Zurücksetzen des Passworts (per Mail, Admin oder Kommandozeile). */
export const passwordResets = sqliteTable(
  'password_resets',
  {
    /** SHA-256 des Tokens; das Token selbst steht nur im Link. */
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    /** Woher der Link stammt: mail, admin oder cli. */
    source: text('source', { enum: ['mail', 'admin', 'cli'] }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index('password_resets_user_idx').on(table.userId)],
);

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

/** Protokoll aller Änderungen an Fremdsystemen (Technitium usw.), wer wann was getan hat. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: timestamps.createdAt,
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Name zum Zeitpunkt der Aktion, bleibt auch nach Löschen des Benutzers lesbar. */
    username: text('username'),
    action: text('action').notNull(),
    target: text('target'),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    error: text('error'),
  },
  (table) => [index('audit_log_at_idx').on(table.at)],
);

/** Gespeicherte Listenansichten (Suche, Filter, Sortierung, Spalten), je Benutzer. */
export const savedViews = sqliteTable(
  'saved_views',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['ipam', 'dns', 'audit'] }).notNull(),
    name: text('name').notNull(),
    params: text('params', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    hidden: text('hidden', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [uniqueIndex('saved_views_unique').on(table.userId, table.scope, table.name)],
);

export const ipamNetworks = sqliteTable('ipam_networks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  cidr: text('cidr').notNull(),
  vlanId: integer('vlan_id'),
  gateway: text('gateway'),
  description: text('description'),
  scan: integer('scan', { mode: 'boolean' }).notNull().default(true),
  lastScanAt: text('last_scan_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const ipamCategories = sqliteTable('ipam_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Farbschlüssel aus der Palette (z. B. „blue“), nicht der Farbwert selbst. */
  color: text('color').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const ipamRanges = sqliteTable(
  'ipam_ranges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    networkId: integer('network_id')
      .notNull()
      .references(() => ipamNetworks.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => ipamCategories.id, { onDelete: 'cascade' }),
    startAddress: text('start_address').notNull(),
    endAddress: text('end_address').notNull(),
    label: text('label'),
    ...timestamps,
  },
  (table) => [index('ipam_ranges_network_idx').on(table.networkId)],
);

/** Per Ping gefundene oder bestätigte Geräte; Erreichbarkeit und Zeitpunkte. */
export const ipamHosts = sqliteTable('ipam_hosts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull().unique(),
  name: text('name'),
  /** false = neu entdeckt und hervorgehoben, true = vom Admin als bekannt bestätigt */
  acknowledged: integer('acknowledged', { mode: 'boolean' }).notNull().default(false),
  alive: integer('alive', { mode: 'boolean' }).notNull().default(true),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  lastCheckedAt: text('last_checked_at').notNull(),
});

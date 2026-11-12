import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadMailConfig, publicUrlFromEnv, type MailConfig } from './auth/mailer.js';
import { loadOidcConfig, type OidcConfig } from './auth/oidc.js';
import type { TechnitiumConnection } from './technitium/client.js';
import { connectionFromEnv } from './technitium/service.js';
import type { ProxmoxConnection } from './proxmox/client.js';
import { proxmoxFromEnv } from './proxmox/service.js';
import { updateConfigFromEnv, type UpdateConfig } from './update/service.js';

const here = fileURLToPath(new URL('.', import.meta.url));

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} muss eine positive Zahl sein`);
  return value;
}

export interface AppConfig {
  host: string;
  port: number;
  databaseFile: string;
  migrationsFolder: string;
  /** Ordner mit dem gebauten Frontend; null = kein statisches Ausliefern (Entwicklung). */
  webRoot: string | null;
  statusIntervalSeconds: number;
  statusTimeoutMs: number;
  /** Abstand zwischen zwei Abrufen eines RSS-Feeds. */
  feedIntervalMinutes: number;
  logLevel: string;
  /** null = Anmeldung nur lokal */
  oidc: OidcConfig | null;
  /**
   * Fester Mailserver aus SMTP_HOST und Co.; null = in der Oberfläche einstellbar. Fehlt das
   * Feld (Tests), werden die Umgebungsvariablen gelesen.
   */
  mail?: MailConfig | null;
  /** PUBLIC_URL für Links in Mails, auch wenn der Mailserver in der Oberfläche eingestellt ist. */
  publicUrl?: string | null;
  /**
   * Feste Technitium-Verbindung aus TECHNITIUM_URL/TECHNITIUM_TOKEN; null = in der Oberfläche
   * einstellbar. Fehlt das Feld (Tests), werden die Umgebungsvariablen gelesen.
   */
  technitium?: TechnitiumConnection | null;
  /** Feste Proxmox-Verbindung aus PROXMOX_URL/PROXMOX_TOKEN_ID/PROXMOX_TOKEN_SECRET, sonst wie oben. */
  proxmox?: ProxmoxConnection | null;
  /** Update-Prüfung (UPDATE_CHECK, UPDATE_REPO …); fehlt das Feld (Tests), werden die Umgebungsvariablen gelesen. */
  update?: UpdateConfig;
}

export function loadConfig(): AppConfig {
  // Im Build liegt main.js in dist/, im Dev-Modus src/config.ts in src/.
  const appRoot = resolve(here, '..');
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: intFromEnv('PORT', 3000),
    databaseFile:
      process.env.DATABASE_FILE ?? resolve(process.env.DATA_DIR ?? './data', 'ultimate-dash.db'),
    migrationsFolder: process.env.MIGRATIONS_DIR ?? resolve(appRoot, 'drizzle'),
    webRoot: process.env.WEB_ROOT ? resolve(process.env.WEB_ROOT) : null,
    statusIntervalSeconds: intFromEnv('STATUS_INTERVAL_SECONDS', 60),
    statusTimeoutMs: intFromEnv('STATUS_TIMEOUT_MS', 5000),
    feedIntervalMinutes: intFromEnv('FEED_INTERVAL_MINUTES', 30),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    oidc: loadOidcConfig(),
    mail: loadMailConfig(),
    publicUrl: publicUrlFromEnv(),
    technitium: connectionFromEnv(),
    proxmox: proxmoxFromEnv(),
    update: updateConfigFromEnv(),
  };
}

import { eq } from 'drizzle-orm';
import {
  mailSettingsInput,
  mailTestInput,
  type MailSettings,
  type MailSettingsInput,
  type MailTestInput,
  type MailTestResult,
  type User,
} from '@ultimate-dash/shared';
import type { AuditLog } from '../db/audit.js';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';
import type { MailConfig, Mailer, MailerFactory, MailServerConfig } from '../auth/mailer.js';

const SETTINGS_KEY = 'mail';

export type MailErrorKind = 'not-configured' | 'invalid' | 'auth' | 'unreachable' | 'tls' | 'send';

/** Fehler beim Mailversand, mit einer Meldung für die Oberfläche. */
export class MailError extends Error {
  constructor(
    message: string,
    readonly kind: MailErrorKind,
  ) {
    super(message);
  }

  get statusCode(): number {
    if (this.kind === 'not-configured') return 409;
    if (this.kind === 'invalid') return 400;
    return 502;
  }
}

/** Übersetzt Fehler von nodemailer in verständliche Meldungen. */
export function describeMailError(error: unknown, config: MailServerConfig): MailError {
  if (error instanceof MailError) return error;
  const e = error as { code?: string; responseCode?: number; message?: string };
  const server = `${config.host}:${config.port}`;
  const detail = e.message ? ` (${e.message})` : '';
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    return new MailError(`Der Mailserver hat Benutzer oder Passwort abgelehnt${detail}`, 'auth');
  }
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION' || e.code === 'EDNS') {
    return new MailError(`Mailserver ${server} nicht erreichbar${detail}`, 'unreachable');
  }
  if (e.code === 'ETLS' || /certificate|ssl|tls|wrong version/i.test(e.message ?? '')) {
    return new MailError(
      `TLS-Verbindung zu ${server} fehlgeschlagen. Passen Verschlüsselung und Port zusammen (STARTTLS meist 587, SSL/TLS meist 465)? Bei einem selbst signierten Zertifikat „Zertifikat nicht prüfen“ wählen.${detail}`,
      'tls',
    );
  }
  if (e.code === 'ESOCKET') {
    return new MailError(`Verbindung zu ${server} fehlgeschlagen${detail}`, 'unreachable');
  }
  if (e.code === 'EENVELOPE' || (e.responseCode && e.responseCode >= 500)) {
    return new MailError(`Der Mailserver hat die Mail abgelehnt${detail}`, 'send');
  }
  return new MailError(`Mailversand fehlgeschlagen${detail}`, 'send');
}

const testMailText = (username: string, config: MailServerConfig) =>
  [
    `Hallo ${username},`,
    '',
    'das ist eine Testmail von Ultimate Dash. Der Mailversand funktioniert.',
    '',
    `Server: ${config.host}:${config.port}`,
    `Verschlüsselung: ${{ none: 'keine', starttls: 'STARTTLS', tls: 'SSL/TLS' }[config.encryption]}`,
    `Absender: ${config.from}`,
  ].join('\n');

/**
 * Mailserver für „Passwort vergessen“ und Testmails. Wie bei Technitium und Proxmox gilt:
 * Sind SMTP_HOST und Co. gesetzt, gelten diese und die Oberfläche zeigt sie nur an.
 */
export class MailService {
  private cached: { key: string; mailer: Mailer } | null = null;

  constructor(
    private readonly options: {
      db: Db;
      audit: AuditLog;
      envConfig: MailConfig | null;
      envPublicUrl: string | null;
      createMailer: MailerFactory;
    },
  ) {}

  private stored(): (MailServerConfig & { publicUrl: string | null }) | null {
    const row = this.options.db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    const value = row?.value as Partial<MailServerConfig & { publicUrl: string }> | undefined;
    if (!value?.host || !value.port || !value.from || !value.encryption) return null;
    return {
      host: value.host,
      port: value.port,
      encryption: value.encryption,
      user: value.user ?? null,
      password: value.password ?? null,
      from: value.from,
      tlsInsecure: value.tlsInsecure ?? false,
      publicUrl: value.publicUrl ?? null,
    };
  }

  /** Gültige Einstellungen samt Link-Adresse; null = kein Mailversand. */
  config(): MailConfig | null {
    if (this.options.envConfig) return this.options.envConfig;
    const stored = this.stored();
    const publicUrl = this.options.envPublicUrl ?? stored?.publicUrl;
    if (!stored || !publicUrl) return null;
    return { ...stored, publicUrl };
  }

  private mailerFor(config: MailServerConfig): Mailer {
    const key = JSON.stringify(config);
    if (this.cached?.key !== key) {
      this.cached = { key, mailer: this.options.createMailer(config) };
    }
    return this.cached.mailer;
  }

  /** Für den Passwort-Reset: Versand und Link-Adresse, oder null ohne Mailserver. */
  current(): { mailer: Mailer; publicUrl: string } | null {
    const config = this.config();
    return config ? { mailer: this.mailerFor(config), publicUrl: config.publicUrl } : null;
  }

  getSettings(): MailSettings {
    const env = this.options.envConfig;
    const stored = env ?? this.stored();
    const envPublicUrl = env?.publicUrl ?? this.options.envPublicUrl;
    const base = {
      publicUrl: envPublicUrl ?? stored?.publicUrl ?? null,
      publicUrlFromEnv: envPublicUrl !== null,
    };
    if (!stored) {
      return {
        host: null,
        port: null,
        encryption: 'starttls',
        user: null,
        hasPassword: false,
        from: null,
        tlsInsecure: false,
        source: null,
        ...base,
      };
    }
    return {
      host: stored.host,
      port: stored.port,
      encryption: stored.encryption,
      user: stored.user,
      hasPassword: !!stored.password,
      from: stored.from,
      tlsInsecure: stored.tlsInsecure,
      source: env ? 'env' : 'settings',
      ...base,
    };
  }

  /** Ergänzt ein leer gelassenes Passwort aus den gespeicherten Einstellungen. */
  private resolve(input: ReturnType<typeof mailSettingsInput.parse>) {
    const stored = this.options.envConfig ?? this.stored();
    const user = input.user ?? null;
    // Das gespeicherte Passwort gehört zu Server und Benutzer, nicht zu einem anderen Konto.
    const keep = stored && stored.host === input.host && stored.user === user;
    const password = user ? (input.password ?? (keep ? stored.password : null)) : null;
    const config: MailServerConfig = {
      host: input.host,
      port: input.port,
      encryption: input.encryption,
      user,
      password,
      from: input.from,
      tlsInsecure: input.tlsInsecure,
    };
    return { config, publicUrl: input.publicUrl ?? null };
  }

  /** Schickt eine Testmail mit den eingegebenen Einstellungen, ohne sie zu speichern. */
  async test(raw: MailTestInput, user: User): Promise<MailTestResult> {
    const { to, ...rest } = mailTestInput.parse(raw);
    const { config } = this.resolve(rest);
    try {
      await this.options.createMailer(config).send({
        to,
        subject: 'Ultimate Dash: Testmail',
        text: testMailText(user.username, config),
      });
    } catch (error) {
      const mailError = describeMailError(error, config);
      this.options.audit.record({
        user,
        action: 'mail.test',
        target: to,
        ok: false,
        error: mailError.message,
      });
      throw mailError;
    }
    this.options.audit.record({ user, action: 'mail.test', target: to, ok: true });
    return { to };
  }

  /** Speichert nur, wenn Verbindung und Anmeldung am Mailserver klappen. */
  async save(raw: MailSettingsInput, user: User): Promise<MailSettings> {
    if (this.options.envConfig) {
      throw new MailError(
        'Der Mailserver ist über Umgebungsvariablen festgelegt und kann hier nicht geändert werden',
        'not-configured',
      );
    }
    const { config, publicUrl } = this.resolve(mailSettingsInput.parse(raw));
    if (!this.options.envPublicUrl && !publicUrl) {
      throw new MailError(
        'Bitte die Adresse des Dashboards angeben, sonst lassen sich keine Links verschicken',
        'invalid',
      );
    }
    if (config.user && !config.password) {
      throw new MailError('Bitte das Passwort für den Mailserver angeben', 'invalid');
    }
    try {
      await this.options.createMailer(config).verify();
    } catch (error) {
      throw describeMailError(error, config);
    }
    const value = { ...config, publicUrl };
    this.options.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    this.options.audit.record({
      user,
      action: 'mail.connect',
      target: `${config.host}:${config.port}`,
      ok: true,
    });
    return this.getSettings();
  }

  disconnect(user: User) {
    this.options.db.delete(settings).where(eq(settings.key, SETTINGS_KEY)).run();
    this.cached = null;
    this.options.audit.record({ user, action: 'mail.disconnect', ok: true });
  }
}

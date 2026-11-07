import nodemailer from 'nodemailer';
import { mailEncryption, type MailEncryption } from '@ultimate-dash/shared';

export interface MailServerConfig {
  host: string;
  port: number;
  /** none = unverschlüsselt, starttls = STARTTLS ist Pflicht, tls = direkt per TLS (meist 465). */
  encryption: MailEncryption;
  user: string | null;
  password: string | null;
  from: string;
  /** Selbstsignierte Zertifikate am Mailserver akzeptieren. */
  tlsInsecure: boolean;
}

export interface MailConfig extends MailServerConfig {
  /**
   * Öffentliche Adresse des Dashboards für Links in Mails. Bewusst fest eingestellt und nicht
   * aus dem Host-Header abgeleitet, sonst könnte ein Angreifer Links auf seine Seite umleiten.
   */
  publicUrl: string;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
  /** Verbindung und Anmeldung prüfen, ohne etwas zu senden. */
  verify(): Promise<void>;
}

export type MailerFactory = (config: MailServerConfig) => Mailer;

const bool = (raw: string | undefined, fallback: boolean) =>
  raw === undefined || raw === ''
    ? fallback
    : ['1', 'true', 'yes', 'ja'].includes(raw.toLowerCase());

/** Verschlüsselung aus SMTP_ENCRYPTION, sonst wie bisher aus SMTP_SECURE und dem Port. */
function encryptionFromEnv(env: NodeJS.ProcessEnv, port: number): MailEncryption {
  const raw = env.SMTP_ENCRYPTION?.trim().toLowerCase();
  if (raw) {
    const parsed = mailEncryption.safeParse(raw === 'ssl' ? 'tls' : raw);
    if (!parsed.success) throw new Error('SMTP_ENCRYPTION muss none, starttls oder tls sein');
    return parsed.data;
  }
  return bool(env.SMTP_SECURE, port === 465) ? 'tls' : 'starttls';
}

/** Liest die SMTP-Einstellungen; null, wenn kein Mailversand per Umgebung eingerichtet ist. */
export function loadMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const from = env.SMTP_FROM?.trim();
  if (!from) throw new Error('Für den Mailversand muss SMTP_FROM gesetzt sein');
  const publicUrl = publicUrlFromEnv(env);
  if (!publicUrl) {
    throw new Error('Für den Mailversand muss PUBLIC_URL gesetzt sein (z. B. https://dash.lan)');
  }
  const port = Number.parseInt(env.SMTP_PORT ?? '', 10) || 587;
  return {
    host,
    port,
    encryption: encryptionFromEnv(env, port),
    user: env.SMTP_USER?.trim() || null,
    password: env.SMTP_PASSWORD || null,
    from,
    tlsInsecure: bool(env.SMTP_TLS_INSECURE, false),
    publicUrl,
  };
}

/** PUBLIC_URL ohne abschließenden Schrägstrich; null, wenn nicht gesetzt. */
export function publicUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PUBLIC_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('PUBLIC_URL muss mit http:// oder https:// beginnen');
  return url.href.replace(/\/+$/, '');
}

/** Ein Mailserver, der nicht antwortet, soll Formular und Reset nicht minutenlang blockieren. */
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

export const createSmtpMailer: MailerFactory = (config) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'tls',
    requireTLS: config.encryption === 'starttls',
    ignoreTLS: config.encryption === 'none',
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    tls: config.tlsInsecure ? { rejectUnauthorized: false } : undefined,
    ...TIMEOUTS,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: config.from, to, subject, text });
    },
    async verify() {
      await transport.verify();
    },
  };
};

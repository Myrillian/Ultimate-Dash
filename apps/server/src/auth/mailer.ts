import nodemailer from 'nodemailer';

export interface MailConfig {
  host: string;
  port: number;
  /** Direkt per TLS verbinden (Port 465); sonst STARTTLS, wenn der Server es anbietet. */
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
  /** Selbstsignierte Zertifikate am Mailserver akzeptieren. */
  tlsInsecure: boolean;
  /**
   * Öffentliche Adresse des Dashboards für Links in Mails. Bewusst fest eingestellt und nicht
   * aus dem Host-Header abgeleitet, sonst könnte ein Angreifer Links auf seine Seite umleiten.
   */
  publicUrl: string;
}

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

const bool = (raw: string | undefined, fallback: boolean) =>
  raw === undefined || raw === ''
    ? fallback
    : ['1', 'true', 'yes', 'ja'].includes(raw.toLowerCase());

/** Liest die SMTP-Einstellungen; null, wenn kein Mailversand eingerichtet ist. */
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
    secure: bool(env.SMTP_SECURE, port === 465),
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

export function createSmtpMailer(config: MailConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    tls: config.tlsInsecure ? { rejectUnauthorized: false } : undefined,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: config.from, to, subject, text });
    },
  };
}

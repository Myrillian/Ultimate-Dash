import { z } from 'zod';
import { httpUrl } from './schemas.js';

/** Verschlüsselung zum Mailserver: keine, STARTTLS (Pflicht) oder direkt SSL/TLS. */
export const mailEncryption = z.enum(['none', 'starttls', 'tls']);
export type MailEncryption = z.infer<typeof mailEncryption>;

/** Üblicher Port je Verschlüsselung, als Vorschlag im Formular. */
export const DEFAULT_MAIL_PORTS: Record<MailEncryption, number> = {
  none: 25,
  starttls: 587,
  tls: 465,
};

/** Hostname oder IP-Adresse, ohne Schema und ohne Port. */
export const mailHost = z
  .string()
  .trim()
  .min(1, 'Bitte den Mailserver angeben')
  .max(253)
  .regex(
    /^(\[[0-9a-fA-F:.]+\]|[0-9a-fA-F:]*:[0-9a-fA-F:.]+|[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*)$/,
    'Nur Hostname oder IP-Adresse, z. B. mail.example.org oder 192.168.1.10',
  );

const addressPart = z.email('Ungültige E-Mail-Adresse');

/** Absender als `dash@example.org` oder `Ultimate Dash <dash@example.org>`. */
export const mailFrom = z
  .string()
  .trim()
  .min(1, 'Bitte eine Absenderadresse angeben')
  .max(320)
  .refine((value) => {
    const match = /^(?:[^<>]*<([^<>]+)>|([^<>\s]+))$/.exec(value);
    const address = match?.[1] ?? match?.[2];
    return !!address && addressPart.safeParse(address.trim()).success;
  }, 'Format: dash@example.org oder Ultimate Dash <dash@example.org>');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : undefined));

/** Einstellungen des Mailservers. Das Passwort verlässt den Server nie. */
export const mailSettingsInput = z.object({
  host: mailHost,
  port: z.coerce
    .number()
    .int('Ungültiger Port')
    .min(1, 'Ungültiger Port')
    .max(65535, 'Ungültiger Port'),
  encryption: mailEncryption,
  /** Leer = ohne Anmeldung senden. */
  user: optionalText(200),
  /** Leer oder weggelassen = bisheriges Passwort behalten. */
  password: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value ? value : undefined)),
  from: mailFrom,
  /** Adresse des Dashboards für Links in Mails; entfällt, wenn PUBLIC_URL gesetzt ist. */
  publicUrl: z
    .union([z.literal(''), httpUrl])
    .optional()
    .nullable()
    .transform((value) => (value ? value.replace(/\/+$/, '') : undefined)),
  /** Selbst signiertes Zertifikat am Mailserver akzeptieren. */
  tlsInsecure: z.boolean().default(false),
});
export type MailSettingsInput = z.input<typeof mailSettingsInput>;

/** Testmail mit den eingegebenen (nicht unbedingt gespeicherten) Einstellungen. */
export const mailTestInput = mailSettingsInput.extend({
  to: z.string().trim().pipe(z.email('Ungültige E-Mail-Adresse')),
});
export type MailTestInput = z.input<typeof mailTestInput>;

export interface MailSettings {
  host: string | null;
  port: number | null;
  encryption: MailEncryption;
  user: string | null;
  hasPassword: boolean;
  from: string | null;
  tlsInsecure: boolean;
  publicUrl: string | null;
  /** PUBLIC_URL ist per Umgebungsvariable gesetzt und gilt immer. */
  publicUrlFromEnv: boolean;
  /** env = über Umgebungsvariablen gesetzt und daher in der Oberfläche nicht änderbar */
  source: 'env' | 'settings' | null;
}

export interface MailTestResult {
  to: string;
}

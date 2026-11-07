import { z } from 'zod';

export const role = z.enum(['admin', 'viewer']);
export type Role = z.infer<typeof role>;

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Nur Kleinbuchstaben, Ziffern sowie . _ - erlaubt');

/** Mindestens 10 Zeichen; Länge schützt besser als Sonderzeichen-Regeln. */
export const password = z.string().min(10, 'Mindestens 10 Zeichen').max(200);

export const loginInput = z.object({
  username: z.string().trim().toLowerCase().min(1).max(40),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.input<typeof loginInput>;

export const setupInput = z.object({ username, password });
export type SetupInput = z.input<typeof setupInput>;

export const passwordChangeInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});
export type PasswordChangeInput = z.input<typeof passwordChangeInput>;

/** E-Mail-Adresse für den Passwort-Reset; leer = keine. */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .pipe(z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]))
  .transform((value) => (value === '' ? null : value));

export const userCreateInput = z.object({
  username,
  password,
  role: role.default('viewer'),
  email: email.nullable().optional(),
});
export type UserCreateInput = z.input<typeof userCreateInput>;

export const userUpdateInput = z.object({
  role: role.optional(),
  /** Neues Passwort setzen (Admin setzt es für einen anderen Benutzer zurück). */
  password: password.optional(),
  email: email.nullable().optional(),
});
export type UserUpdateInput = z.input<typeof userUpdateInput>;

/** Eigene E-Mail-Adresse ändern (Selbstbedienung). */
export const emailChangeInput = z.object({ email: email.nullable() });
export type EmailChangeInput = z.input<typeof emailChangeInput>;

/** „Passwort vergessen“: Benutzername oder E-Mail-Adresse. */
export const forgotPasswordInput = z.object({
  login: z.string().trim().toLowerCase().min(1, 'Bitte ausfüllen').max(200),
});
export type ForgotPasswordInput = z.input<typeof forgotPasswordInput>;

/** Token aus dem Reset-Link (32 Zufallsbytes, base64url). */
export const resetToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,100}$/, 'Ungültiger Link');

export const resetCheckInput = z.object({ token: resetToken });
export type ResetCheckInput = z.input<typeof resetCheckInput>;

export const resetPasswordInput = z.object({ token: resetToken, password });
export type ResetPasswordInput = z.input<typeof resetPasswordInput>;

/** Pfad der Seite, auf die Reset-Links zeigen; das Token steht im Fragment (#token=…). */
export const RESET_PATH = '/passwort-zuruecksetzen';

/** Ein Reset-Link, den ein Admin erzeugt hat, um ihn selbst weiterzugeben. */
export interface ResetLink {
  token: string;
  expiresAt: string;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  /** Hat ein lokales Passwort. */
  hasPassword: boolean;
  /** Ist mit einer OIDC-Identität verknüpft. */
  oidc: boolean;
  email: string | null;
  /** Zeitpunkt, zu dem der Benutzer „Passwort vergessen“ angefragt hat und noch keine Mail möglich war. */
  resetRequestedAt: string | null;
}

export const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  viewer: 'Benutzer',
};

export interface AuthStatus {
  /** true, solange noch kein Benutzer existiert. */
  setupRequired: boolean;
  user: User | null;
  /** Gesetzt, wenn die Anmeldung über OIDC eingerichtet ist. */
  oidc: {
    label: string;
    /** Rollen von SSO-Benutzern kommen bei jeder Anmeldung aus den Gruppen des Anbieters. */
    rolesFromGroups: boolean;
  } | null;
  /** true, wenn „Passwort vergessen“ eine E-Mail verschicken kann (SMTP eingerichtet). */
  passwordResetMail: boolean;
}

/** Fehlercodes, mit denen der OIDC-Callback zurück zur Anmeldung leitet (`?login_error=`). */
export const oidcErrorMessages = {
  state:
    'Die Anmeldung ist abgelaufen oder wurde in einem anderen Tab gestartet. Bitte erneut versuchen.',
  provider: 'Der Anmeldedienst hat die Anmeldung abgelehnt.',
  unavailable: 'Der Anmeldedienst ist nicht erreichbar.',
  forbidden: 'Dein Konto hat keinen Zugriff auf dieses Dashboard.',
  unknown_user: 'Für dieses Konto gibt es hier keinen Benutzer. Ein Administrator muss es anlegen.',
  setup: 'Lege zuerst das lokale Administrator-Konto an.',
} as const;
export type OidcErrorCode = keyof typeof oidcErrorMessages;

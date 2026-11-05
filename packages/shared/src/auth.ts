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

export const userCreateInput = z.object({ username, password, role: role.default('viewer') });
export type UserCreateInput = z.input<typeof userCreateInput>;

export const userUpdateInput = z.object({
  role: role.optional(),
  /** Neues Passwort setzen (Admin setzt es für einen anderen Benutzer zurück). */
  password: password.optional(),
});
export type UserUpdateInput = z.input<typeof userUpdateInput>;

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
}

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

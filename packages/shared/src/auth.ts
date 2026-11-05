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
}

export interface AuthStatus {
  /** true, solange noch kein Benutzer existiert. */
  setupRequired: boolean;
  user: User | null;
}

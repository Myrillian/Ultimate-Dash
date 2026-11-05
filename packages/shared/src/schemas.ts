import { z } from 'zod';

// Deutsche Fehlermeldungen für alle Validierungen in Frontend und Backend.
z.config(z.locales.de());

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null);

/** http(s)-URL, wie sie für Links und Statusprüfungen erlaubt ist. */
export const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Nur http- und https-Adressen sind erlaubt');

export const linkTarget = z.enum(['_blank', '_self']);
export type LinkTarget = z.infer<typeof linkTarget>;

export const groupInput = z.object({
  name: trimmed(80),
  icon: optionalText(200),
  collapsed: z.boolean().default(false),
});
export type GroupInput = z.input<typeof groupInput>;

export const group = groupInput.extend({
  id: z.number().int().positive(),
  sortOrder: z.number().int(),
  icon: z.string().nullable(),
});
export type Group = z.infer<typeof group>;

export const serviceInput = z.object({
  groupId: z.number().int().positive(),
  name: trimmed(80),
  url: httpUrl,
  description: optionalText(200),
  icon: optionalText(500),
  target: linkTarget.default('_blank'),
  statusCheck: z.boolean().default(true),
  /** Abweichende Adresse für die Statusprüfung, z. B. eine interne URL hinter einem Reverse-Proxy. */
  statusUrl: httpUrl.nullish().transform((value) => value ?? null),
  tags: z.array(trimmed(40)).max(20).default([]),
});
export type ServiceInput = z.input<typeof serviceInput>;

export const service = serviceInput.extend({
  id: z.number().int().positive(),
  sortOrder: z.number().int(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  statusUrl: z.string().nullable(),
});
export type Service = z.infer<typeof service>;

export const reorderInput = z.object({
  /** IDs in der gewünschten Reihenfolge. */
  ids: z.array(z.number().int().positive()).min(1),
});

export const moveServiceInput = reorderInput.extend({
  groupId: z.number().int().positive(),
});

export interface DashboardGroup extends Group {
  services: Service[];
}

export interface DashboardData {
  title: string;
  groups: DashboardGroup[];
}

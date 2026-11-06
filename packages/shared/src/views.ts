import { z } from 'zod';

/** Listen, für die jeder Benutzer Ansichten (Suche, Filter, Sortierung, Spalten) speichern kann. */
export const viewScopes = ['ipam', 'dns'] as const;
export type ViewScope = (typeof viewScopes)[number];

export const savedViewInput = z.object({
  scope: z.enum(viewScopes),
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  /** Die Werte aus der Adresszeile (q, type, sort …); leere Werte werden nicht gespeichert. */
  params: z
    .record(z.string().min(1).max(30), z.string().max(500))
    .refine((value) => Object.keys(value).length <= 20, 'Zu viele Filter'),
  /** Ausgeblendete Spalten. */
  hidden: z.array(z.string().max(30)).max(30).default([]),
});
export type SavedViewInput = z.input<typeof savedViewInput>;

export interface SavedView {
  id: number;
  scope: ViewScope;
  name: string;
  params: Record<string, string>;
  hidden: string[];
}

import { z } from 'zod';
import { groupInput, serviceInput } from './schemas.js';

/**
 * Format der YAML-Datei für Export und Import. Bewusst ohne IDs, damit sich die Datei
 * von Hand bearbeiten und zwischen Installationen übertragen lässt.
 */
export const configServiceEntry = serviceInput.omit({ groupId: true });
export const configGroupEntry = groupInput.extend({
  services: z.array(configServiceEntry).max(500).default([]),
});

export const configFile = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(80).optional(),
  groups: z.array(configGroupEntry).max(200).default([]),
});
export type ConfigFile = z.input<typeof configFile>;
export type ParsedConfigFile = z.output<typeof configFile>;

/** replace = alles ersetzen; merge = Gruppen und Services gleichen Namens aktualisieren, Rest ergänzen */
export const importMode = z.enum(['replace', 'merge']);
export type ImportMode = z.infer<typeof importMode>;

export const importRequest = z.object({
  yaml: z.string().min(1).max(2_000_000),
  mode: importMode,
  /** Nur prüfen und Zusammenfassung liefern, nichts speichern. */
  dryRun: z.boolean().default(false),
});
export type ImportRequest = z.input<typeof importRequest>;

export interface ImportSummary {
  groupsCreated: number;
  groupsUpdated: number;
  servicesCreated: number;
  servicesUpdated: number;
  /** Nur bei „replace“: so viele bestehende Einträge werden entfernt. */
  groupsRemoved: number;
  servicesRemoved: number;
  titleChanged: boolean;
}

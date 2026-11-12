import { z } from 'zod';

/** Versionsnummer wie `1.2.3` oder `v1.2.3-rc.1` (Semantic Versioning, ohne Build-Zusatz). */
const VERSION_PATTERN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Vorabkennung wie `rc.1`; leer bei einer fertigen Version. */
  pre: string[];
}

export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Einheitliche Schreibweise ohne führendes „v“; null bei ungültigen Versionen. */
export function normalizeVersion(input: string): string | null {
  const parsed = parseVersion(input);
  if (!parsed) return null;
  const pre = parsed.pre.length ? `-${parsed.pre.join('.')}` : '';
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${pre}`;
}

function comparePre(a: string[], b: string[]): number {
  // Eine fertige Version ist neuer als jede Vorabversion.
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Negativ, wenn a älter ist als b; 0 bei Gleichstand. Ungültige Versionen gelten als älteste. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

export const updateMode = z.enum(['self', 'manual', 'disabled']);
/**
 * self = Installation per `install.sh`, Update direkt aus der Oberfläche möglich.
 * manual = z. B. Docker: Prüfung ja, Installation von Hand.
 * disabled = Prüfung per `UPDATE_CHECK=false` abgeschaltet.
 */
export type UpdateMode = z.infer<typeof updateMode>;

export const updateRelease = z.object({
  version: z.string(),
  name: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  /** Änderungsprotokoll (Text der GitHub-Release-Notizen). */
  body: z.string(),
});
export type UpdateRelease = z.infer<typeof updateRelease>;

export const updateProgressState = z.enum(['queued', 'running', 'ok', 'failed']);
export type UpdateProgressState = z.infer<typeof updateProgressState>;

export interface UpdateProgress {
  state: UpdateProgressState;
  version: string;
  message: string;
  at: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  mode: UpdateMode;
  /** Wann zuletzt bei GitHub nachgefragt wurde; null = noch nie. */
  checkedAt: string | null;
  /** Fehler der letzten Prüfung (Netzwerk, Rate-Limit …); null = alles gut. */
  error: string | null;
  updateAvailable: boolean;
  /** Neueste Version; null, wenn es noch keine Veröffentlichung gibt. */
  latest: UpdateRelease | null;
  /** Alle Veröffentlichungen, die neuer sind als die installierte Version (neueste zuerst). */
  releases: UpdateRelease[];
  progress: UpdateProgress | null;
  /** Befehl für die manuelle Installation, wenn `mode` nicht `self` ist. */
  manualHint: string | null;
}

/**
 * Installation anstoßen. `acknowledged` muss ausdrücklich `true` sein: die Oberfläche setzt es
 * erst, nachdem der Admin das Änderungsprotokoll gelesen und bestätigt hat.
 */
export const updateInstallInput = z.object({
  version: z.string().trim().min(1).max(60),
  acknowledged: z.literal(true, { error: 'Das Änderungsprotokoll muss bestätigt werden' }),
});
export type UpdateInstallInput = z.infer<typeof updateInstallInput>;

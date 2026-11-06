import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IconCatalog } from '@ultimate-dash/shared';

/**
 * Verzeichnis der verfügbaren Icons für die Auswahl im Formular.
 * Die Listen kommen aus den öffentlichen Repos von Dashboard Icons und selfh.st,
 * werden einen Tag lang zwischengespeichert und zusätzlich auf Platte abgelegt,
 * damit die Auswahl auch ohne Internet (oder bei Ausfällen) funktioniert.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCES = {
  di: [
    'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json',
    'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/tree.json',
  ],
  sh: [
    'https://cdn.jsdelivr.net/gh/selfhst/icons/index.json',
    'https://raw.githubusercontent.com/selfhst/icons/main/index.json',
  ],
};

export type FetchJson = (url: string) => Promise<unknown>;

export const defaultFetchJson: FetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};

/** Dashboard Icons: `{ svg: ['proxmox.svg', …], png: […] }` → Referenzen, SVG bevorzugt. */
export function parseDashboardIcons(data: unknown): string[] {
  const tree = data as Record<string, unknown>;
  const names = (key: string) =>
    Array.isArray(tree?.[key])
      ? (tree[key] as unknown[]).filter((f): f is string => typeof f === 'string')
      : [];
  const svg = new Set(names('svg').map((f) => f.replace(/\.svg$/, '')));
  const refs = [...svg];
  // Nur als PNG vorhandene Icons mit Endung, damit die richtige Datei geladen wird.
  for (const file of names('png')) {
    const base = file.replace(/\.png$/, '');
    if (!svg.has(base)) refs.push(`${base}.png`);
  }
  return refs.sort();
}

/** selfh.st: `[{ Reference: 'proxmox', SVG: 'Yes', PNG: 'Yes' }, …]` → Referenzen. */
export function parseSelfhst(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const refs: string[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    const ref = entry?.Reference;
    if (typeof ref !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(ref)) continue;
    if (entry.SVG === 'Yes') refs.push(ref);
    else if (entry.PNG === 'Yes') refs.push(`${ref}.png`);
    if (entry.Dark === 'Yes' && entry.SVG === 'Yes') refs.push(`${ref}-dark`);
    if (entry.Light === 'Yes' && entry.SVG === 'Yes') refs.push(`${ref}-light`);
  }
  return [...new Set(refs)].sort();
}

export class IconCatalogService {
  private catalog: IconCatalog | null = null;
  private loading: Promise<IconCatalog> | null = null;

  constructor(
    private readonly options: {
      cacheFile: string | null;
      fetchJson?: FetchJson;
      onError?: (error: unknown) => void;
    },
  ) {}

  /** Liefert das Verzeichnis; lädt neu, wenn es älter als ein Tag ist. */
  async get(): Promise<IconCatalog> {
    if (!this.catalog) this.catalog = await this.readCache();
    const fresh = this.catalog && Date.now() - Date.parse(this.catalog.updatedAt) < DAY_MS;
    if (fresh) return this.catalog!;
    if (this.catalog) {
      // Veraltetes Verzeichnis sofort ausliefern und im Hintergrund erneuern.
      void this.refresh().catch(() => undefined);
      return this.catalog;
    }
    return this.refresh();
  }

  private refresh(): Promise<IconCatalog> {
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<IconCatalog> {
    const [di, sh] = await Promise.all([
      this.fetchFirst(SOURCES.di, parseDashboardIcons),
      this.fetchFirst(SOURCES.sh, parseSelfhst),
    ]);
    const previous = this.catalog;
    const next: IconCatalog = {
      // Fällt eine Quelle aus, bleibt ihr letzter Stand erhalten.
      di: di ?? previous?.di ?? [],
      sh: sh ?? previous?.sh ?? [],
      updatedAt:
        di && sh ? new Date().toISOString() : (previous?.updatedAt ?? new Date(0).toISOString()),
    };
    this.catalog = next;
    if (di || sh) await this.writeCache(next);
    return next;
  }

  private async fetchFirst(urls: string[], parse: (data: unknown) => string[]) {
    const fetchJson = this.options.fetchJson ?? defaultFetchJson;
    for (const url of urls) {
      try {
        const refs = parse(await fetchJson(url));
        if (refs.length > 0) return refs;
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    return null;
  }

  private async readCache(): Promise<IconCatalog | null> {
    if (!this.options.cacheFile) return null;
    try {
      const data = JSON.parse(await readFile(this.options.cacheFile, 'utf8')) as IconCatalog;
      return Array.isArray(data.di) && Array.isArray(data.sh) ? data : null;
    } catch {
      return null;
    }
  }

  private async writeCache(catalog: IconCatalog) {
    if (!this.options.cacheFile) return;
    try {
      await mkdir(dirname(this.options.cacheFile), { recursive: true });
      const temp = `${this.options.cacheFile}.tmp`;
      await writeFile(temp, JSON.stringify(catalog));
      await rename(temp, this.options.cacheFile);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}

/** Suche in Iconify (Material Design Icons, Simple Icons) über deren öffentliche API. */
export async function searchIconify(
  query: string,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<string[]> {
  const url = new URL('https://api.iconify.design/search');
  url.searchParams.set('query', query);
  url.searchParams.set('prefixes', 'mdi,simple-icons');
  url.searchParams.set('limit', '64');
  const data = (await fetchJson(url.href)) as { icons?: unknown };
  return Array.isArray(data?.icons)
    ? data.icons.filter((i): i is string => typeof i === 'string')
    : [];
}

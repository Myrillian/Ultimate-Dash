/** Bausteine für Such-, Filter- und Sortierfunktionen der Listen (IP-Liste, DHCP, DNS). */

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Suchtext in einzelne Begriffe zerlegen; jeder Begriff muss vorkommen (UND). */
export const tokensOf = (query: string): string[] =>
  query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);

export const matchesAll = (haystack: string, tokens: string[]): boolean =>
  tokens.every((token) => haystack.includes(token));

/** Vergleich für Text mit Zahlen („host2“ vor „host10“), ohne Groß-/Kleinschreibung. */
export const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });

/** `name` = aufsteigend, `-name` = absteigend; unbekannte Schlüssel fallen auf den Standard zurück. */
export function parseSort(
  value: string | null,
  allowed: readonly string[],
  fallback: SortState,
): SortState {
  if (!value) return fallback;
  const dir: SortDir = value.startsWith('-') ? 'desc' : 'asc';
  const key = value.replace(/^-/, '');
  return allowed.includes(key) ? { key, dir } : fallback;
}

export const formatSort = (sort: SortState): string =>
  sort.dir === 'desc' ? `-${sort.key}` : sort.key;

/** Klick auf eine Spaltenüberschrift: erst aufsteigend, dann absteigend. */
export const nextSort = (current: SortState, key: string): SortState =>
  current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };

export const splitList = (value: string | null): string[] =>
  value ? value.split(',').filter(Boolean) : [];

/** Wert in einer Auswahl umschalten (Chip an/aus). */
export const toggleIn = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

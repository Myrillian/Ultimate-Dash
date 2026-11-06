import type { DashboardGroup, Service } from '@ultimate-dash/shared';

export interface SearchHit {
  service: Service;
  groupName: string;
  score: number;
}

export const normalize = (value: string) =>
  value
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss');

/** Hostname ohne Protokoll, damit "pve" auch "https://pve.home.lan" findet. */
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Durchsucht Name, Tags, Beschreibung, Host und Gruppenname. Treffer im Namen
 * zählen am meisten, Wortanfänge mehr als Treffer mitten im Wort.
 */
export function searchServices(groups: DashboardGroup[], query: string): SearchHit[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const group of groups) {
    for (const service of group.services) {
      const fields: [string, number][] = [
        [normalize(service.name), 10],
        [normalize(service.tags.join(' ')), 6],
        [normalize(host(service.url)), 4],
        [normalize(service.description ?? ''), 3],
        [normalize(group.name), 2],
      ];
      let score = 0;
      let allMatched = true;
      for (const term of terms) {
        let best = 0;
        for (const [text, weight] of fields) {
          const index = text.indexOf(term);
          if (index === -1) continue;
          const wordStart = index === 0 || /[\s\-_.:/]/.test(text[index - 1]!);
          best = Math.max(best, weight * (wordStart ? 2 : 1) + (index === 0 ? 1 : 0));
        }
        if (best === 0) {
          allMatched = false;
          break;
        }
        score += best;
      }
      if (allMatched) hits.push({ service, groupName: group.name, score });
    }
  }
  return hits.sort(
    (a, b) => b.score - a.score || a.service.name.localeCompare(b.service.name, 'de'),
  );
}

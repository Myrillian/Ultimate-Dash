import type { IconCatalog } from '@ultimate-dash/shared';
import { normalize } from './search.js';

export type IconSource = 'di' | 'sh' | 'iconify';

export interface IconOption {
  /** Wert fürs Icon-Feld, z. B. `di:proxmox` */
  value: string;
  /** Anzeigename ohne Präfix und Endung */
  label: string;
  source: IconSource;
}

export const sourceLabels: Record<IconSource, string> = {
  di: 'Dashboard Icons',
  sh: 'selfh.st',
  iconify: 'Material & Simple Icons',
};

const toOption = (source: 'di' | 'sh', ref: string): IconOption => ({
  value: `${source}:${ref}`,
  label: ref.replace(/\.(png|webp|svg)$/, ''),
  source,
});

/**
 * Sucht im Icon-Verzeichnis. Alle Suchwörter müssen vorkommen; Treffer am Wortanfang
 * und exakte Treffer stehen vorne, Varianten wie „-dark“ hinter dem Grund-Icon.
 */
export function searchCatalog(
  catalog: IconCatalog,
  query: string,
  sources: ('di' | 'sh')[] = ['di', 'sh'],
): IconOption[] {
  const tokens = normalize(query)
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  const results: { option: IconOption; score: number }[] = [];
  for (const source of sources) {
    for (const ref of catalog[source]) {
      const option = toOption(source, ref);
      const label = option.label;
      if (tokens.length > 0 && !tokens.every((t) => label.includes(t))) continue;
      const compact = tokens.join('-');
      let score = label.length / 100;
      if (tokens.length > 0) {
        if (label === compact) score -= 10;
        else if (label.startsWith(compact)) score -= 5;
        else if (label.split(/[-_.]/).some((part) => part.startsWith(tokens[0]!))) score -= 2;
      }
      if (/-(dark|light)$/.test(label)) score += 0.5;
      if (source === 'sh') score += 0.01; // bei Gleichstand Dashboard Icons zuerst
      results.push({ option, score });
    }
  }
  return results
    .sort((a, b) => a.score - b.score || a.option.label.localeCompare(b.option.label))
    .map((r) => r.option);
}

export function iconifyOptions(icons: string[]): IconOption[] {
  return icons.map((value) => ({
    value,
    label: value.replace(/^simple-icons:/, '').replace(/^mdi:/, ''),
    source: 'iconify' as const,
  }));
}

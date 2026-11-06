import { describe, expect, it } from 'vitest';
import {
  compareText,
  formatSort,
  matchesAll,
  nextSort,
  parseSort,
  splitList,
  tokensOf,
  toggleIn,
} from './list-filter';

describe('Listenbausteine', () => {
  it('sucht mit mehreren Begriffen und ignoriert Groß-/Kleinschreibung', () => {
    const tokens = tokensOf('  Synology  NAS ');
    expect(tokens).toEqual(['synology', 'nas']);
    expect(matchesAll('nas.home.lan synology incorporated', tokens)).toBe(true);
    expect(matchesAll('nas.home.lan apple', tokens)).toBe(false);
    expect(matchesAll('irgendwas', [])).toBe(true);
  });
  it('sortiert Zahlen im Text natürlich', () => {
    expect(['host10', 'host2', 'Host1'].sort(compareText)).toEqual(['Host1', 'host2', 'host10']);
  });
  it('liest und schreibt die Sortierung', () => {
    const fallback = { key: 'address', dir: 'asc' as const };
    expect(parseSort('-name', ['name', 'address'], fallback)).toEqual({ key: 'name', dir: 'desc' });
    expect(parseSort('boese', ['name'], fallback)).toEqual(fallback);
    expect(parseSort(null, ['name'], fallback)).toEqual(fallback);
    expect(formatSort({ key: 'name', dir: 'desc' })).toBe('-name');
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'mac')).toEqual({ key: 'mac', dir: 'asc' });
  });
  it('zerlegt und schaltet Listen um', () => {
    expect(splitList('a,b,,c')).toEqual(['a', 'b', 'c']);
    expect(splitList(null)).toEqual([]);
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
  });
});

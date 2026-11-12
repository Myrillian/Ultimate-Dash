import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDays,
  formatAgo,
  formatDuration,
  formatLeaseTime,
  formatPercent,
  formatRemaining,
  formatTick,
  niceTicks,
} from './format';

describe('Zahlenformate', () => {
  it('formatiert Zähler deutsch und große Werte kompakt', () => {
    expect(formatCount(12900)).toBe('12.900');
    expect(formatCount(1_340_000)).toMatch(/^1,3\sMio\.$/);
  });

  it('beschriftet Achsen ab 10.000 kompakt', () => {
    expect(formatTick(2000, 8000)).toBe('2.000');
    expect(formatTick(20_000, 40_000)).toBe('20K');
  });

  it('rundet Anteile und zeigt kleine mit Nachkommastelle', () => {
    expect(formatPercent(1, 3)).toBe('33 %');
    expect(formatPercent(5, 1000)).toBe('0,5 %');
    expect(formatPercent(0, 0)).toBe('0 %');
  });

  it('erzeugt runde Achsenschritte bis über das Maximum', () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('zeigt Restzeit als Minuten oder Stunden', () => {
    expect(formatRemaining(65_000)).toBe('1:05 Min.');
    expect(formatRemaining(3_900_000)).toBe('1:05 Std.');
  });

  it('formatiert Dauern', () => {
    expect(formatDuration(2160)).toBe('1 Tag 12 Std.');
    expect(formatDuration(90)).toBe('1 Std. 30 Min.');
    expect(formatDuration(2880)).toBe('2 Tage');
    expect(formatDuration(0)).toBe('0 Min.');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-11-06T12:00:00Z').getTime();
  it('formuliert relative Zeiten', () => {
    expect(formatAgo('2026-11-06T11:59:50Z', now)).toBe('gerade eben');
    expect(formatAgo('2026-11-06T11:55:00Z', now)).toBe('vor 5 Min.');
    expect(formatAgo('2026-11-06T09:00:00Z', now)).toBe('vor 3 Std.');
    expect(formatAgo('2026-11-02T12:00:00Z', now)).toBe('vor 4 Tagen');
  });
});

describe('Lease-Zeiten', () => {
  it('liest ISO (aktuelle Versionen) und das alte US-Format', () => {
    const iso = '2026-11-07T20:00:00.765Z';
    const local = new Date(Date.parse(iso));
    const expected = new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(local);
    expect(formatLeaseTime(iso)).toBe(expected);
    expect(formatLeaseTime('11/07/2026 20:00:00')).toBe('07.11.26, 20:00');
    expect(formatLeaseTime('irgendwas')).toBe('irgendwas');
    expect(formatLeaseTime(null)).toBe('–');
  });
});

describe('formatDays', () => {
  it('beschreibt die Restlaufzeit', () => {
    expect(formatDays(30)).toBe('30 Tage');
    expect(formatDays(1)).toBe('1 Tag');
    expect(formatDays(0)).toBe('läuft heute ab');
    expect(formatDays(-1)).toBe('seit 1 Tag abgelaufen');
    expect(formatDays(-3)).toBe('seit 3 Tagen abgelaufen');
  });
});

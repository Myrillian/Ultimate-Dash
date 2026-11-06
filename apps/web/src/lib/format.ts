const full = new Intl.NumberFormat('de-DE');
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

/** 1.284 · 12.900 → „12.900“ unter einer Million, darüber kompakt („1,3 Mio.“). */
export function formatCount(value: number): string {
  return Math.abs(value) < 1_000_000 ? full.format(value) : compact.format(value);
}

/** Achsenbeschriftung: unter 10.000 ausgeschrieben, sonst kompakt („20.000“ → „20K“). */
export function formatTick(value: number, max: number): string {
  if (max < 10_000) return full.format(value);
  if (max < 1_000_000) return `${full.format(Math.round(value / 1000))}K`;
  return compact.format(value);
}

export function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0 %';
  const share = (part / total) * 100;
  return `${share < 10 && share > 0 ? share.toFixed(1).replace('.', ',') : Math.round(share)} %`;
}

/** Runde Achsenwerte: 0 bis zu einer „schönen“ Obergrenze in 3–5 Schritten. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}

/** „in 12 Min.“, „in 1:05 Std.“ – für Countdowns. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')} Std.`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')} Min.`;
}

/** 2160 → „1 Tag 12 Std.“, 90 → „1 Std. 30 Min.“ */
export function formatDuration(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? 'Tag' : 'Tage'}` : '',
    hours ? `${hours} Std.` : '',
    minutes ? `${minutes} Min.` : '',
  ].filter(Boolean);
  return parts.join(' ') || '0 Min.';
}

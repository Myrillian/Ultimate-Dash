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

/** „gerade eben“, „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“ für einen ISO-Zeitpunkt. */
export function formatAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

const leaseTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Zeitpunkt einer DHCP-Lease: ISO (aktuelle Technitium-Versionen, UTC) oder „MM/dd/yyyy HH:mm:ss“
 * (ältere, Serverzeit). Unlesbares bleibt unverändert stehen.
 */
export function formatLeaseTime(value: string | null): string {
  if (!value) return '–';
  const legacy = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (legacy) {
    const [, mo, d, y, h, mi, se] = legacy.map(Number) as number[];
    return leaseTime.format(new Date(y!, mo! - 1, d!, h!, mi!, se!));
  }
  const time = /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? value : leaseTime.format(new Date(time));
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const decimal = (value: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);

/** Bytes in Binäreinheiten wie in Proxmox: 44040192 → „42 MiB“, 1,5 GiB → „1,5 GiB“. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${decimal(value)} ${UNITS[unit]}`;
}

/** Durchsatz: „1,2 MiB/s“. */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Laufzeit in Sekunden: „12 Tage“, „5 Std.“, „3 Min.“ */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} Std.`;
  return `${Math.max(1, Math.floor(seconds / 60))} Min.`;
}

/** Restlaufzeit eines Zertifikats: 0 → „läuft heute ab“, 5 → „5 Tage“, -2 → „seit 2 Tagen abgelaufen“. */
export function formatDays(days: number): string {
  if (days < 0) return `seit ${-days} ${-days === 1 ? 'Tag' : 'Tagen'} abgelaufen`;
  if (days === 0) return 'läuft heute ab';
  return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
}

/**
 * Icon-Angaben werden in eine Bild-URL übersetzt:
 * - `https://…` oder `/…` → direkt
 * - `di:name`  → Dashboard Icons (homarr-labs)
 * - `sh:name`  → selfh.st Icons
 * - `prefix:name` → Iconify (z. B. `mdi:server`, `simple-icons:proxmox`)
 * Ohne Angabe wird ein Initialen-Icon gezeigt.
 */
export type ResolvedIcon =
  { kind: 'image'; src: string } | { kind: 'initials'; text: string; hue: number };

const DI_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const SH_BASE = 'https://cdn.jsdelivr.net/gh/selfhst/icons';

/** `proxmox` → svg/proxmox.svg, `foo.png` → png/foo.png (Icons, die es nur als Bitmap gibt). */
function iconFileUrl(base: string, ref: string): string {
  const match = /^(.+)\.(png|webp|svg)$/.exec(ref);
  const [name, ext] = match ? [match[1]!, match[2]!] : [ref, 'svg'];
  return `${base}/${ext}/${encodeURIComponent(name)}.${ext}`;
}

const ICONIFY = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function resolveIcon(icon: string | null | undefined, name: string): ResolvedIcon {
  const value = icon?.trim();
  if (value) {
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return { kind: 'image', src: value };
    if (value.startsWith('di:'))
      return { kind: 'image', src: iconFileUrl(DI_BASE, value.slice(3)) };
    if (value.startsWith('sh:'))
      return { kind: 'image', src: iconFileUrl(SH_BASE, value.slice(3)) };
    const match = ICONIFY.exec(value);
    if (match)
      return { kind: 'image', src: `https://api.iconify.design/${match[1]}/${match[2]}.svg` };
  }
  return { kind: 'initials', text: initials(name), hue: hueFor(name) };
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Stabiler Farbton pro Name, damit Initialen-Icons unterscheidbar bleiben. */
export function hueFor(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

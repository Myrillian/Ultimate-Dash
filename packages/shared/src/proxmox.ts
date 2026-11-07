import { z } from 'zod';
import { httpUrl } from './schemas.js';

/** Token-ID wie in Proxmox angezeigt: `benutzer@realm!tokenname`. */
export const proxmoxTokenId = z
  .string()
  .trim()
  .regex(
    /^[^\s@!=]+@[^\s@!=]+![A-Za-z][A-Za-z0-9._-]*$/,
    'Format: benutzer@realm!tokenname, z. B. dashboard@pve!ultimate-dash',
  );

/** Verbindungsdaten zu Proxmox VE. Das Secret verlässt den Server nie. */
export const proxmoxSettingsInput = z.object({
  url: httpUrl.transform((value) => value.replace(/\/+$/, '')),
  tokenId: proxmoxTokenId,
  /** Leer oder weggelassen = bisheriges Secret behalten. */
  secret: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Selbst signiertes Zertifikat akzeptieren. */
  tlsInsecure: z.boolean().default(false),
});
export type ProxmoxSettingsInput = z.input<typeof proxmoxSettingsInput>;

export interface ProxmoxSettings {
  url: string | null;
  tokenId: string | null;
  hasSecret: boolean;
  tlsInsecure: boolean;
  /** env = über Umgebungsvariablen gesetzt und daher in der Oberfläche nicht änderbar */
  source: 'env' | 'settings' | null;
}

export interface ProxmoxTestResult {
  version: string;
  nodes: string[];
  vms: number;
  containers: number;
  /** Rechte des Tokens, die über reines Lesen hinausgehen (leer = alles in Ordnung) */
  extraPrivileges: string[];
}

export interface ProxmoxGuest {
  id: number;
  name: string;
  /** running, stopped, paused, … wie von Proxmox gemeldet */
  status: string;
}

export interface ProxmoxGuestCount {
  total: number;
  running: number;
  /** Alle Gäste, die nicht laufen, nach ID sortiert */
  notRunning: ProxmoxGuest[];
}

export interface ProxmoxStorage {
  name: string;
  /** dir, lvmthin, zfspool, nfs, … */
  type: string;
  used: number;
  total: number;
  shared: boolean;
}

export interface ProxmoxSummary {
  fetchedAt: string;
  /** Knotennamen; beim Einzelhost genau einer */
  nodes: { name: string; online: boolean; uptime: number }[];
  cpu: { usage: number; cores: number };
  /** Bytes */
  memory: { used: number; total: number };
  /** Bytes pro Sekunde über die Schnittstellen des Hosts; null = noch kein Wert */
  network: { in: number; out: number } | null;
  /** Bytes pro Sekunde, Summe der laufenden Gäste; null = erst ab dem zweiten Abruf */
  diskIo: { read: number; write: number } | null;
  storages: ProxmoxStorage[];
  vms: ProxmoxGuestCount;
  containers: ProxmoxGuestCount;
  /** Verlauf der letzten Stunde aus Proxmox (Minutenwerte) */
  history: { times: number[]; cpu: number[]; netIn: number[]; netOut: number[] };
}

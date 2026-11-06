import { execFile } from 'node:child_process';

/** Wahr, wenn die Adresse auf einen ICMP-Echo-Request antwortet. */
export type Pinger = (address: string) => Promise<boolean>;

export class PingUnavailableError extends Error {
  constructor() {
    super('Das Programm „ping“ ist auf dem Server nicht verfügbar');
  }
}

/**
 * Nutzt das System-`ping` (ein Paket, eine Sekunde Wartezeit), weil Node ohne Root-Rechte keine
 * rohen ICMP-Pakete senden kann. Im Docker-Image ist iputils-ping enthalten.
 */
export const systemPing: Pinger = (address) =>
  new Promise((resolve, reject) => {
    execFile('ping', ['-c', '1', '-W', '1', address], { timeout: 3000 }, (error) => {
      if (!error) return resolve(true);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return reject(new PingUnavailableError());
      // Exit-Code 1 = keine Antwort, alles andere (z. B. kein Netz) zählt ebenfalls als „nicht erreichbar“.
      resolve(false);
    });
  });

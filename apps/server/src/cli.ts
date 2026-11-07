import { RESET_PATH } from '@ultimate-dash/shared';
import { publicUrlFromEnv } from './auth/mailer.js';
import { createAuthStore } from './auth/store.js';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/client.js';

const USAGE = `Befehle:
  reset-link <benutzername>   Einmal-Link zum Zurücksetzen des Passworts erzeugen (24 Stunden gültig)`;

/**
 * Kommandozeile für Notfälle, z. B. wenn der einzige Admin sein Passwort vergessen hat:
 *   docker exec -u node ultimate-dash node dist/main.js reset-link admin
 * Gibt den Exit-Code zurück.
 */
export function runCli(args: string[], config: AppConfig, print = console.log): number {
  const [command, username] = args;
  if (command !== 'reset-link' || !username) {
    print(USAGE);
    return command === 'help' || command === '--help' ? 0 : 1;
  }
  const { db, close } = openDatabase(config.databaseFile, config.migrationsFolder);
  try {
    const store = createAuthStore(db);
    const user = store.findByUsername(username.trim().toLowerCase());
    if (!user) {
      print(`Benutzer „${username}“ gibt es nicht.`);
      return 1;
    }
    const { token, expiresAt } = store.createPasswordReset(user.id, 'cli');
    const base = publicUrlFromEnv() ?? 'http://<adresse-des-dashboards>';
    print(`Reset-Link für ${user.username} (gültig bis ${expiresAt}):`);
    print(`${base}${RESET_PATH}#token=${token}`);
    return 0;
  } finally {
    close();
  }
}

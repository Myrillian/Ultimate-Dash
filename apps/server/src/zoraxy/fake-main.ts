// Startet den simulierten Zoraxy für die lokale Entwicklung:
// pnpm --filter @ultimate-dash/server fake:zoraxy
import { startFakeZoraxy } from './fake-server.js';

const fake = await startFakeZoraxy(Number(process.env.PORT ?? 8000));
console.log(
  `Simulierter Zoraxy läuft auf ${fake.url} (Benutzer: ${fake.username}, Passwort: ${fake.password})`,
);

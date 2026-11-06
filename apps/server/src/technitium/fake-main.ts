// Startet den simulierten Technitium-Server für die lokale Entwicklung:
// pnpm --filter @ultimate-dash/server fake:technitium
import { startFakeTechnitium } from './fake-server.js';

const fake = await startFakeTechnitium(
  Number(process.env.PORT ?? 5380),
  process.env.TOKEN ?? 'dev-token',
);
console.log(`Simulierter Technitium läuft auf ${fake.url} (Token: ${fake.token})`);

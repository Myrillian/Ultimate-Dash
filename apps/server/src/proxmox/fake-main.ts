// Startet den simulierten Proxmox VE für die lokale Entwicklung:
// pnpm --filter @ultimate-dash/server fake:proxmox
import { startFakeProxmox } from './fake-server.js';

const fake = await startFakeProxmox(Number(process.env.PORT ?? 8006));
console.log(
  `Simulierter Proxmox läuft auf ${fake.url} (Token-ID: ${fake.tokenId}, Secret: ${fake.secret})`,
);

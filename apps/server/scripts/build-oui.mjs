// Erzeugt src/ipam/oui.json aus der IEEE-OUI-Liste.
// Aufruf: node scripts/build-oui.mjs <Pfad zu oui-data/index.json>
// (das npm-Paket „oui-data“ enthält die öffentliche IEEE-Liste als JSON; Ablauf in README)
import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) {
  console.error('Pfad zur index.json des Pakets oui-data fehlt');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(source, 'utf8'));
const out = {};
for (const [prefix, text] of Object.entries(raw)) {
  // Erste Zeile ist der Name, danach folgt die Anschrift.
  const name = String(text).split('\n')[0].trim();
  if (/^[0-9A-F]{6}$/i.test(prefix) && name) out[prefix.toUpperCase()] = name;
}
const keys = Object.keys(out).sort();
const sorted = Object.fromEntries(keys.map((k) => [k, out[k]]));
writeFileSync(new URL('../src/ipam/oui.json', import.meta.url), JSON.stringify(sorted) + '\n');
console.log(`${keys.length} Hersteller geschrieben`);

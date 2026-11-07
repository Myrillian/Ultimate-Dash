# Hinweise zu Drittanbietern

Ultimate Dash steht unter der [MIT-Lizenz](LICENSE). Diese Datei nennt fremde Software, Daten und Marken, die das Projekt nutzt oder erwähnt. Stand: 07.11.2026.

## Software im ausgelieferten Programm

Alle Abhängigkeiten, die im Docker-Image oder im gebauten Frontend landen, stehen unter freizügigen Lizenzen. Die vollständigen Lizenztexte liegen jeweils im Paket (`node_modules/<paket>/LICENSE`, im Image unter `/app/node_modules`).

**Backend (direkte Abhängigkeiten)**

| Paket                                     | Lizenz     |
| ----------------------------------------- | ---------- |
| fastify, @fastify/cookie, @fastify/static | MIT        |
| better-sqlite3                            | MIT        |
| drizzle-orm                               | Apache-2.0 |
| fast-xml-parser                           | MIT        |
| nodemailer                                | MIT-0      |
| openid-client                             | MIT        |
| undici                                    | MIT        |
| yaml                                      | ISC        |
| zod                                       | MIT        |

Indirekte Abhängigkeiten (rund 155 Pakete) verteilen sich auf MIT, ISC, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0 und MIT-0. Copyleft-Lizenzen kommen im ausgelieferten Programm nicht vor. Die aktuelle Liste erzeugt `pnpm licenses list --prod`.

**Frontend (im gebauten JavaScript/CSS enthalten)**

| Paket             | Lizenz | Copyright                                                     |
| ----------------- | ------ | ------------------------------------------------------------- |
| svelte            | MIT    | © 2016–2025 Svelte Contributors                               |
| @sveltejs/kit     | MIT    | © 2020 SvelteKit Contributors                                 |
| devalue           | MIT    | © 2018–19 devalue Contributors                                |
| esm-env           | MIT    | © 2022 Benjamin McCann                                        |
| clsx              | MIT    | © Luke Edwards                                                |
| cookie            | MIT    | © 2012–2014 Roman Shtylman, © 2015 Douglas Christopher Wilson |
| set-cookie-parser | MIT    | © 2015 Nathan Friedly                                         |
| svelte-dnd-action | MIT    | © 2020 Isaac Hagoel                                           |
| tailwindcss       | MIT    | © Tailwind Labs, Inc.                                         |
| zod               | MIT    | © 2025 Colin McDonnell                                        |

Für alle oben genannten MIT-Pakete gilt derselbe Lizenztext wie in [LICENSE](LICENSE), mit dem jeweiligen Rechteinhaber.

**Nur beim Bauen und Entwickeln** (nicht im Programm enthalten): u. a. Vite, esbuild, TypeScript, Vitest, drizzle-kit, Prettier (alle MIT/Apache-2.0) sowie lightningcss (MPL-2.0).

**Docker-Basisimage:** `node:22-bookworm-slim` (Node.js unter MIT, dazu Debian-Pakete unter ihren jeweiligen Lizenzen, teils GPL). Wer ein fertiges Image weitergibt, gibt damit auch diese Debian-Pakete weiter. Ihre Lizenztexte liegen im Image unter `/usr/share/doc/*/copyright`.

## Mitgelieferte Daten

- **Hersteller zu MAC-Adressen** (`apps/server/src/ipam/oui.json`): aus der öffentlichen OUI-Liste (MA-L) der IEEE Registration Authority, umgewandelt über das npm-Paket `oui-data`. Übernommen sind nur Präfix und Herstellername.
- **Standard-RSS-Feeds** (`packages/shared/src/feeds.ts`): nur Name und Adresse öffentlicher Feeds. Inhalte werden erst zur Laufzeit beim jeweiligen Anbieter abgerufen. Siehe [docs/rechtliches.md](docs/rechtliches.md#rss-feeds).

## Externe Quellen zur Laufzeit

Diese Dienste werden nicht mitgeliefert, sondern bei Bedarf abgerufen:

| Quelle                                                                          | Wofür                             | Wer ruft ab                      | Lizenz der Inhalte                                                 |
| ------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) über jsDelivr | Icons mit `di:`                   | Browser (Bilder), Server (Liste) | Repository unter Apache-2.0; Logos bleiben Marken ihrer Inhaber    |
| [selfh.st Icons](https://selfh.st/icons/) über jsDelivr                         | Icons mit `sh:`                   | Browser (Bilder), Server (Liste) | CC BY 4.0; Logos bleiben Marken ihrer Inhaber                      |
| [Iconify](https://iconify.design/) (`api.iconify.design`)                       | Icons wie `mdi:`, `simple-icons:` | Browser                          | je Icon-Set verschieden (z. B. MDI: Apache-2.0, Simple Icons: CC0) |
| RSS-Feeds                                                                       | Neuigkeiten                       | Server                           | Urheberrecht der jeweiligen Anbieter                               |

## Marken

Proxmox® ist eine eingetragene Marke der Proxmox Server Solutions GmbH. Technitium ist ein Name von Technitium (Shreyas Zare). Docker® ist eine Marke von Docker, Inc. Home Assistant, Authentik, Keycloak, Authelia, Pocket ID sowie alle weiteren genannten Produkt-, Firmen- und Feednamen gehören ihren jeweiligen Inhabern.

Ultimate Dash ist ein unabhängiges Projekt. Es steht in keiner Verbindung zu diesen Inhabern und wird von ihnen weder unterstützt noch geprüft. Die Namen dienen nur dazu, zu beschreiben, mit welchen Programmen Ultimate Dash zusammenarbeitet.

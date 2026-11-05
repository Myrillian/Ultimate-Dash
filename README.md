# Ultimate Dash

Ein selbst gehostetes Dashboard für Homelab und Services: Startseite, Service-Übersicht mit Live-Status und Widgets, dazu ein vollständiges IPAM mit Integration in Technitium DNS Server.

> **Status:** Frühe Entwicklung (Phase 1, Kern-Dashboard). Noch ohne Login, daher nur im vertrauenswürdigen Netz betreiben.

## Ziele

- **Dashboard:** Gruppen, Services, Bookmarks, Icons, Suche, Themes, Statusprüfungen (HTTP/Ping), Widgets mit Live-Daten, Bearbeitung direkt im UI
- **Integrationen:** Docker- und Kubernetes-Discovery, Proxmox, Systemressourcen, generische API- und Prometheus-Widgets
- **IPAM mit Technitium:** Netze, Gerätegruppen, farbiges IP-Raster, DNS-Einträge, DHCP-Leases und -Reservierungen verwalten, Wizard für neue IPs
- **DNS-Statistiken und Blocking:** Grafiken zu Queries und Blocking, Blocking pausieren, Domains blockieren oder erlauben
- **Sicherheit:** alle Fremd-APIs laufen über das Backend, Login lokal oder per OIDC, Änderungsprotokoll

## Dokumentation

| Dokument                                          | Inhalt                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Feature-Vergleich](docs/01-feature-vergleich.md) | Analyse von Homepage, Dashy, Heimdall, Flame, Mafl und Rackula mit Vergleichstabellen |
| [IPAM & Technitium](docs/02-ipam-technitium.md)   | Was die Technitium-API kann, was fehlt, Gerätegruppen, Wizard „Neue IP“               |
| [Architektur](docs/03-architektur.md)             | Frontend, Backend, Phasen, Risiken, Limitierungen                                     |
| [Entscheidungen](docs/04-entscheidungen.md)       | Getroffene Grundsatzentscheidungen                                                    |

## Stack

SvelteKit (SPA) + Tailwind im Frontend, Fastify im Backend, SQLite (Drizzle ORM), alles in TypeScript, ausgeliefert als ein Docker-Container.

```
apps/web        SvelteKit-Frontend
apps/server     Fastify-Backend, Datenbank, Statusprüfung
packages/shared Gemeinsame Typen und Validierung (Zod)
docs/           Planung und Entscheidungen
```

## Starten

### Docker

```bash
docker compose up -d --build
```

Danach läuft das Dashboard auf http://localhost:3000. Daten liegen in `./data`.

### Entwicklung

Voraussetzungen: Node.js 22 und pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev          # Backend auf :3000, Frontend mit Hot Reload auf :5173
pnpm check        # Typprüfung
pnpm test         # Tests
pnpm format       # Formatierung
```

### Umgebungsvariablen

| Variable                  | Standard | Bedeutung                        |
| ------------------------- | -------- | -------------------------------- |
| `PORT`                    | `3000`   | HTTP-Port                        |
| `DATA_DIR`                | `./data` | Ordner für die SQLite-Datenbank  |
| `STATUS_INTERVAL_SECONDS` | `60`     | Abstand der Statusprüfungen      |
| `STATUS_TIMEOUT_MS`       | `5000`   | Zeitlimit pro Statusprüfung      |
| `LOG_LEVEL`               | `info`   | `debug`, `info`, `warn`, `error` |
| `LOG_REQUESTS`            | `false`  | Jede HTTP-Anfrage loggen         |

## Icons

Im Icon-Feld eines Services oder einer Gruppe:

- `di:proxmox` für [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons)
- `sh:technitium` für [selfh.st Icons](https://selfh.st/icons/)
- `mdi:server` oder `simple-icons:proxmox` für alle [Iconify](https://icon-sets.iconify.design/)-Sets
- eine Bild-URL

Ohne Icon zeigt das Dashboard farbige Initialen.

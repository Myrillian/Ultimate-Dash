# Ultimate Dash

Ein selbst gehostetes Dashboard für Homelab und Services: Startseite, Service-Übersicht mit Live-Status und Widgets, dazu ein vollständiges IPAM mit Integration in Technitium DNS Server.

> **Status:** Konzeptphase. Es gibt noch keinen Code. Die Planung steht unter [`docs/`](docs/).

## Ziele

- **Dashboard:** Gruppen, Services, Bookmarks, Icons, Suche, Themes, Statusprüfungen (HTTP/Ping), Widgets mit Live-Daten, Bearbeitung direkt im UI
- **Integrationen:** Docker- und Kubernetes-Discovery, Proxmox, Systemressourcen, generische API- und Prometheus-Widgets
- **IPAM mit Technitium:** Netze, Gerätegruppen, farbiges IP-Raster, DNS-Einträge, DHCP-Leases und -Reservierungen verwalten, Wizard für neue IPs
- **DNS-Statistiken und Blocking:** Grafiken zu Queries und Blocking, Blocking pausieren, Domains blockieren oder erlauben
- **Sicherheit:** alle Fremd-APIs laufen über das Backend, Login lokal oder per OIDC, Änderungsprotokoll

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [Feature-Vergleich](docs/01-feature-vergleich.md) | Analyse von Homepage, Dashy, Heimdall, Flame, Mafl und Rackula mit Vergleichstabellen |
| [IPAM & Technitium](docs/02-ipam-technitium.md) | Was die Technitium-API kann, was fehlt, Gerätegruppen, Wizard „Neue IP“ |
| [Architektur](docs/03-architektur.md) | Frontend, Backend, Phasen, Risiken, Limitierungen, offene Entscheidungen |

## Geplanter Stack (noch nicht entschieden)

SvelteKit + TypeScript im Frontend, Fastify + TypeScript im Backend, SQLite, ausgeliefert als ein Docker-Container (amd64/arm64). Details und Alternativen stehen in der [Architektur](docs/03-architektur.md#offene-entscheidungen).

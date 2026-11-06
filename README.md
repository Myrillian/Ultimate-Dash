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

Danach läuft das Dashboard auf `http://<IP des Hosts>:3000`. Daten liegen in `./data`; die Rechte des Ordners setzt der Container beim Start selbst.

Voraussetzung ist Docker mit dem Compose-Plugin. Meldet `docker compose` „unknown shorthand flag: 'd'“, fehlt das Plugin (häufig bei Docker aus dem Paket `docker.io`). Unter Ubuntu hilft `apt install docker-compose-v2`, sonst die [offizielle Anleitung](https://docs.docker.com/compose/install/linux/).

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

## Anmeldung und Benutzer

Beim ersten Aufruf legst du im Browser ein Administrator-Konto an. Danach ist das Dashboard nur nach der Anmeldung erreichbar.

- **Administrator**: darf alles bearbeiten und Benutzer verwalten (Benutzermenü oben rechts).
- **Nur lesen**: sieht das Dashboard, kann aber nichts ändern.

Passwörter werden mit scrypt gespeichert, Sitzungen laufen 30 Tage und verlängern sich bei Nutzung. Nach zehn Fehlversuchen in 15 Minuten wird die Anmeldung für diesen Benutzernamen und diese IP kurz gesperrt. Hinter einem Reverse-Proxy mit HTTPS wird das Cookie automatisch als `Secure` gesetzt, wenn der Proxy `X-Forwarded-Proto` mitsendet.

**Admin-Passwort vergessen?** Container stoppen, die Datei `/data/ultimate-dash.db` sichern und auf dem Host die Tabellen `users` und `sessions` leeren, zum Beispiel mit `sqlite3 ultimate-dash.db "DELETE FROM sessions; DELETE FROM users;"` (das Image enthält kein `sqlite3`). Beim nächsten Aufruf startet die Ersteinrichtung erneut, Dashboard-Inhalte bleiben erhalten.

### Anmeldung über OIDC (Authentik, Keycloak, Authelia, Pocket ID …)

Mit OIDC erscheint auf der Anmeldeseite zusätzlich ein Knopf für deinen SSO-Anbieter. Das lokale Admin-Konto aus der Ersteinrichtung bleibt als Notzugang bestehen.

1. Beim Anbieter eine OIDC-Anwendung („confidential client“) anlegen.
   Redirect-URI: `https://<deine-dashboard-adresse>/api/auth/oidc/callback`
2. Umgebungsvariablen setzen und den Container neu starten:

| Variable                | Standard               | Bedeutung                                                                                                                              |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`           |                        | Issuer-URL, z. B. `https://auth.example.org/application/o/ultimate-dash/` (Authentik)                                                  |
| `OIDC_CLIENT_ID`        |                        | Client-ID                                                                                                                              |
| `OIDC_CLIENT_SECRET`    |                        | Client-Secret (leer lassen bei öffentlichen Clients)                                                                                   |
| `OIDC_REDIRECT_URI`     | aus der Anfrage        | Feste Callback-Adresse, falls der Reverse-Proxy `Host`/`X-Forwarded-Proto` nicht korrekt weitergibt                                    |
| `OIDC_SCOPES`           | `openid profile email` | Für Gruppen ggf. `groups` ergänzen (Authelia, Keycloak mit Mapper)                                                                     |
| `OIDC_BUTTON_LABEL`     | `Mit SSO anmelden`     | Beschriftung des Knopfs                                                                                                                |
| `OIDC_GROUPS_CLAIM`     | `groups`               | Claim mit den Gruppen                                                                                                                  |
| `OIDC_ADMIN_GROUPS`     |                        | Kommagetrennt. Mitglieder werden Admin, alle anderen „Nur lesen“; wird bei jeder Anmeldung abgeglichen                                 |
| `OIDC_ALLOWED_GROUPS`   |                        | Kommagetrennt. Nur Mitglieder dürfen sich anmelden                                                                                     |
| `OIDC_AUTO_CREATE`      | `true`                 | Unbekannte Konten beim ersten Login anlegen; bei `false` werden nur bereits verknüpfte Konten angemeldet                               |
| `OIDC_LINK_BY_USERNAME` | `false`                | Erste SSO-Anmeldung mit einem gleichnamigen lokalen Benutzer verbinden (nur, wenn Benutzernamen beim Anbieter nicht frei wählbar sind) |
| `OIDC_TLS_INSECURE`     | `false`                | Selbstsignierte Zertifikate des Anbieters akzeptieren                                                                                  |

Konten werden über den `sub`-Claim des Anbieters zugeordnet, eine Umbenennung dort ist also unproblematisch. Ohne `OIDC_ADMIN_GROUPS` werden neue SSO-Benutzer als „Nur lesen“ angelegt, und ein Admin vergibt die Rolle in der Benutzerverwaltung. Damit der letzte Admin sich nicht aussperrt, wird er durch fehlende Gruppen nie herabgestuft. Abmelden beendet nur die Sitzung im Dashboard, nicht die beim Anbieter.

## Icons

Im Icon-Feld eines Services oder einer Gruppe:

- `di:proxmox` für [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons)
- `sh:technitium` für [selfh.st Icons](https://selfh.st/icons/)
- `mdi:server` oder `simple-icons:proxmox` für alle [Iconify](https://icon-sets.iconify.design/)-Sets
- eine Bild-URL

Ohne Icon zeigt das Dashboard farbige Initialen.

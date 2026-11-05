# Architektur-Entwurf

> Stand: 05.11.2026. Lebendes Dokument, Arbeitsfassung im Projekt-Dokument.

Entwurf als Diskussionsgrundlage. Die mit **(E)** markierten Punkte sind Empfehlungen, die deine Entscheidung brauchen (siehe „Offene Entscheidungen“).

## Überblick

Ein einziger Docker-Container (multi-arch, amd64/arm64) mit Web-Frontend, API-Backend und Hintergrund-Workern. Alle Zugriffe auf Fremddienste (Technitium, Docker, Proxmox, Widgets) laufen über das Backend, damit API-Keys nie im Browser landen. Daten liegen in einer SQLite-Datenbank im gemounteten `/data`-Ordner.

## Frontend

- **Framework (E):** SvelteKit mit TypeScript, als SPA ausgeliefert. Schlank und schnell (wichtig für eine Startseite), gute Animationen für das IP-Raster. Alternative: React/Next.js (größeres Ökosystem, so wie Homepage).
- **UI:** Tailwind CSS mit Design-Tokens (Themes per CSS-Variablen), Komponentenbibliothek wie bits-ui/shadcn-svelte, Icons über Iconify (deckt MDI, Simple Icons, selfh.st u. a. ab).
- **Diagramme:** ECharts oder Chart.js für Query-Verlauf, Donuts und Sparklines; das IP-Raster als eigene SVG/Canvas-Komponente.
- **Bereiche:** Dashboard (Gruppen, Services, Widgets), IPAM (Netze, Raster, Gruppen, Wizard), DNS & Blocking, Einstellungen, später Rack-Ansicht.
- **Bedienung:** Edit-Mode mit Drag-and-drop direkt im Dashboard, Command Palette (Ctrl+K) für Suche und Aktionen, Tastaturkürzel, mobil nutzbar, PWA.
- **Live-Daten:** Server-Sent Events oder WebSocket für Status, Widget-Werte und Config-Änderungen.
- **i18n:** Deutsch und Englisch von Anfang an.

## Backend

- **Laufzeit (E):** Node.js mit TypeScript und Fastify (gemeinsame Typen mit dem Frontend). Alternative: Go (ein kleines Binary, sehr ressourcenschonend, aber zwei Sprachen im Projekt).
- **Datenbank:** SQLite mit Drizzle ORM und Migrationen. Reicht für ein Homelab, Backup = eine Datei kopieren.
- **Konfiguration (E):** Datenbank als Quelle, Bearbeitung im UI, dazu YAML-Export und -Import (für Backups und Git). Secrets per Umgebungsvariablen oder Docker Secrets (`*_FILE`), verschlüsselt in der DB gespeichert.
- **Integrations-Schicht:** ein Adapter pro Dienst mit einheitlicher Schnittstelle (Verbindung testen, Daten holen, Aktionen ausführen). Technitium ist der erste Adapter; Widgets sind ebenfalls Adapter.
- **Worker/Scheduler:** Statusprüfungen (HTTP, ICMP), Widget-Polling mit Cache, Technitium-Sync (Leases, Reservierungen, Zonen, Statistiken), Docker-Event-Stream für Discovery.
- **REST-API mit OpenAPI-Doku**, später optional MCP-Endpunkt (wie Homepage).
- **Auth (E):** lokales Admin-Konto plus optional OIDC (Authentik, Authelia, Pocket ID). Rollen zunächst „Admin“ und „Nur lesen“.
- **Audit-Log** für alle Schreibaktionen (wer, wann, was, vorher/nachher), vor allem für Technitium.

## Features (Phasen-Vorschlag)

**Phase 1 – Kern-Dashboard (MVP)**

- Gruppen, Services, Bookmarks, Icons, Beschreibungen, Tags
- UI-Editor mit Drag-and-drop, YAML-Export/Import
- HTTP- und Ping-Status mit Antwortzeit
- Suche (lokal und Web), Themes, Hell/Dunkel, Hintergrund
- Login (lokal), Docker-Image, Healthcheck

**Phase 2 – Technitium & IPAM**

- Technitium-Adapter: DNS-Einträge, Leases, Reservierungen, Scopes
- Netze, Kategorien, Bereiche, IP-Raster, Konflikterkennung
- Wizard „Neue IP“
- DNS-Statistik-Grafiken, Blocking-Steuerung
- Audit-Log

**Phase 3 – Integrationen**

- Docker- und Kubernetes-Discovery, Container-Statistiken
- Proxmox (VMs, LXCs, Ressourcen)
- Widget-Katalog (Systemressourcen, Uptime Kuma, \*arr, Home Assistant …), generischer API- und Prometheus-Widget
- OIDC, mehrere Benutzer, Sichtbarkeit nach Rolle

**Phase 4 – Erweiterungen**

- Rack-Ansicht mit Verknüpfung zu Geräten und IPs
- Switch-Management: Switches mit Ports (Typ, Geschwindigkeit, PoE, VLANs), Belegung pro Port (Gerät, IP, Kabel/Patchfeld), Übersicht freier Ports; später optional Live-Daten per SNMP oder Hersteller-API (z. B. UniFi, MikroTik)
- Status-Historie und Benachrichtigungen (z. B. ntfy, Gotify)
- Weitere IPAM-Quellen (UniFi, OPNsense)
- Workspace-View, MCP-Endpunkt

## Probleme und Risiken

- **Zwei Datenquellen im IPAM.** Technitium ist für DNS/DHCP die Wahrheit, das IPAM speichert eigene Daten dazu. Änderungen direkt in der Technitium-Konsole sieht das IPAM erst beim nächsten Sync (Intervall einstellbar, z. B. 30 Sekunden; Webhooks gibt es nicht).
- **Kein Transaktionsschutz in Technitium.** Der Wizard führt mehrere Aufrufe nacheinander aus. Bricht einer ab, muss das Backend zurückrollen. Das ist machbar, aber nicht hundertprozentig atomar.
- **„Set“-Aufrufe überschreiben.** Beim Bearbeiten von Scopes droht Datenverlust, wenn parallel jemand ändert. Gegenmittel: unmittelbar vorher frisch lesen und für Reservierungen die Einzelaufrufe nutzen.
- **ICMP-Ping im Container** braucht die Capability `NET_RAW` oder ein Fallback (TCP-Ping).
- **Docker-Socket** ist ein Sicherheitsrisiko; Empfehlung: Docker-Socket-Proxy mit Leserechten.
- **Umfang.** Der Widget-Katalog von Homepage hat über Jahre 165 Integrationen gesammelt. Den holen wir nicht schnell ein; deshalb ein generischer API-Widget früh und eine saubere Adapter-Schnittstelle, damit Widgets leicht nachzurüsten sind.
- **Experimentelle Technitium-Endpunkte** (Metrics) können sich ändern; die API-Version muss beim Verbinden geprüft werden (Bearer-Auth erst ab v15).

## Limitierungen (bewusst, zumindest anfangs)

- Nur IPv4 im IP-Raster; IPv6 wird als Liste angezeigt (ein /64 lässt sich nicht als Raster darstellen).
- DHCP-Verwaltung nur, wenn Technitium auch DHCP-Server ist. Läuft DHCP z. B. auf dem Router, gibt es nur DNS und eigene IPAM-Daten.
- Dynamische Leases sind nicht editierbar (nur löschen oder umwandeln), weil Technitium das nicht anbietet.
- Query-Logs nur mit installierter Technitium-Log-App.
- Ein Technitium-Server bzw. Cluster pro Instanz; mehrere unabhängige Server wären ein späteres Feature.
- SQLite: ideal für einen Container, nicht für mehrere parallele Instanzen (Hochverfügbarkeit).

## Entscheidungen

Alle Punkte sind entschieden, siehe [Entscheidungen](04-entscheidungen.md).

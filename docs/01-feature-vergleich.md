# Feature-Vergleich bestehender Dashboards

> Stand: 05.11.2026. Lebendes Dokument, Arbeitsfassung im Projekt-Dokument.

Grundlage für das eigene „Ultimate Dash“. Analysiert wurden README, Doku, Konfigurationsschemata, Changelogs und Quellcode der sechs Repos (Stand: jeweils aktueller Default-Branch, geklont am 05.11.2026).

## Kurzüberblick

|  | Homepage | Dashy | Heimdall | Flame | Mafl | Rackula |
| --- | --- | --- | --- | --- | --- | --- |
| Zweck | Service-Dashboard mit Live-Daten | Allround-Dashboard / Startseite | App-Launcher / Startseite | Startseite mit Apps & Bookmarks | Minimalistische Startseite | Rack-Layout-Designer (kein Dashboard) |
| Stack | Next.js (React), Node | Vue 3, Node-Server | PHP / Laravel 11, SQLite | Node/Express, React/Redux, SQLite | Nuxt 3 (Vue), Nitro | Svelte 5, TypeScript, optional Hono/Bun-API |
| Konfiguration | YAML-Dateien | YAML + UI-Editor | nur Web-UI (DB) | nur Web-UI (DB) | eine YAML-Datei | Web-UI, YAML/ZIP-Dateien |
| Lizenz | GPL-3.0 | MIT | MIT | MIT | MIT | MIT |
| Letzter Commit | 04.11.2026 | 02.11.2026 | 29.10.2026 | 25.04.2026 | 07.06.2026 | 04.11.2026 |
| Stärke | 165 Service-Widgets, Docker/K8s/Proxmox, MCP | Funktionsumfang, Auth, Views, UI-Editor | Einfachheit, Multi-User, „Enhanced Apps“ | GUI-Editor, Docker-Labels, Themes | Schlank, schnell, Echtzeit | Rack-Planung, NetBox, Ports/Kabel |

**Einordnung:** Homepage, Dashy, Heimdall, Flame und Mafl sind klassische Dashboards/Startseiten. Rackula ist ein Werkzeug zur Rack-Dokumentation und -Planung. Für ein „ultimatives“ Dashboard ist es als Modul „physische Infrastruktur“ interessant und wird deshalb unten separat behandelt.

## Vergleichstabelle

Legende: ✅ vorhanden · ◐ eingeschränkt oder über Umweg · ❌ nicht vorhanden. Rackula fehlt hier, weil es kein Dashboard ist (siehe eigener Abschnitt).

### Konfiguration & Verwaltung

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Konfiguration per YAML-Datei | ✅ (mehrere Dateien) | ✅ (conf.yml) | ❌ | ❌ | ✅ (config.yml) |
| Bearbeitung im Web-UI | ❌ | ✅ (interaktiver + Roh-Editor) | ✅ | ✅ | ❌ |
| Automatisches Neuladen bei Config-Änderung | ◐ (Refresh-Button leert Cache) | ✅ | – (DB) | – (DB) | ✅ (WebSocket) |
| JSON-Schema / Validierung | ◐ (YAML-Validierung via MCP) | ✅ (Schema für Editoren) | ❌ | ❌ | ◐ (serverseitig) |
| Secrets via Umgebungsvariablen/Dateien | ✅ (`HOMEPAGE_VAR_*`, `HOMEPAGE_FILE_*`) | ✅ | ❌ | ✅ (`*_FILE`, Docker Secrets) | ✅ (`secrets` bleiben im Backend) |
| Import/Export | ❌ | ✅ (Config-Export, Cloud-Backup) | ✅ (JSON-Import/Export) | ◐ (HTML-Bookmark-Importskript) | ❌ |
| Verschlüsseltes Cloud-Backup | ❌ | ✅ (selbst hostbar) | ❌ | ❌ | ❌ |
| REST-API zum Lesen/Schreiben | ❌ | ✅ (`ENABLE_API`, Token) | ✅ (`api/item`) | ✅ (internes API) | ◐ (nur Status/Settings) |
| MCP-Endpunkt für KI-Assistenten | ✅ | ❌ | ❌ | ❌ | ❌ |
| Konfigurationssperre / Read-only | ✅ (MCP read-only Standard) | ✅ (`preventWriteToDisk`, `disableConfiguration`) | ❌ | ◐ (Auth schützt Settings) | – |
| Mehrere Seiten | ◐ (Tabs) | ✅ (lokale + Remote-Unterseiten) | ◐ (Tags als Ordner) | ❌ | ❌ |
| Update-Hinweis | ✅ | ✅ | ❌ | ❌ | ✅ |
| Health-Endpoint | ✅ | ✅ | ✅ (`/health`) | ❌ | ✅ |

### Layout & Darstellung

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Gruppen/Sektionen | ✅ | ✅ | ✅ (Tags) | ◐ (nur Bookmark-Kategorien) | ✅ |
| Verschachtelte Gruppen | ✅ | ✅ (Sub-Items) | ❌ | ❌ | ❌ |
| Tabs | ✅ (per URL-Hash adressierbar) | ✅ (Minimal-View) | ◐ | ❌ | ❌ |
| Alternative Ansichten | ❌ | ✅ (Default, Workspace, Minimal) | ❌ | ❌ | ❌ |
| Spalten/Raster konfigurierbar | ✅ (Spalte/Zeile, max. Spalten) | ✅ (colCount, Größe, Breite/Höhe je Sektion) | ❌ | ❌ | ✅ (Grid je Breakpoint) |
| Einklappbare Sektionen | ✅ (auch initial eingeklappt) | ✅ | ❌ | ❌ | ❌ |
| Drag-and-drop-Sortierung | ❌ | ✅ (Edit-Mode) | ✅ | ✅ | ❌ |
| Anheften (Pin) | ❌ | ❌ | ✅ | ✅ | ❌ |
| Tags an Einträgen | ❌ | ✅ (für Suche) | ✅ | ❌ | ✅ (farbig) |
| Themes | ✅ (Hell/Dunkel + 22 Farbpaletten) | ✅ (\~40 + Tag/Nacht-Theme) | ◐ | ✅ (15 + Theme-Builder) | ✅ (6) |
| UI-Farbeditor | ❌ | ✅ | ❌ | ✅ | ❌ |
| Custom CSS | ✅ | ✅ (auch im UI, je Seite) | ✅ | ✅ | ❌ |
| Custom JS | ✅ | ◐ | ✅ | ❌ | ❌ |
| Hintergrundbild | ✅ (mit Blur/Sättigung/Helligkeit/Opazität) | ✅ | ✅ (Upload oder Trianglify) | ◐ (via CSS) | ❌ |
| Stil-Varianten | ✅ (Header-, Card-, Block-Stile, Schriftarten) | ✅ (Item-Größen, Layouts) | ❌ | ◐ | ❌ |
| Begrüßung / Datum / Uhr | ✅ | ✅ | ❌ | ✅ (eigene Grußformeln) | ❌ |
| Navbar-Links / Footer | ❌ | ✅ (HTML-Footer) | ❌ | ❌ | ❌ |
| PWA (installierbar) | ✅ (Icons, Shortcuts) | ✅ (Offline-Basis) | ❌ | ❌ | ✅ |
| Responsiv / mobil | ✅ (mobiler Quick-Launch-Button) | ✅ | ✅ | ✅ | ✅ |

### Einträge, Icons & Öffnen

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Services/Apps | ✅ | ✅ | ✅ | ✅ | ✅ |
| Separate Bookmarks | ✅ (inkl. Icon-only) | ◐ (als Items) | ◐ | ✅ (in Kategorien) | ❌ |
| Beschreibung | ✅ | ✅ | ✅ | ✅ | ✅ |
| Icon-Quellen | Dashboard Icons, MDI, Simple Icons, selfh.st, URL, lokal | Favicon-Auto, Font Awesome, MDI, Simple Icons, selfh.st, Homelab-Icons, generativ, Emoji, URL, lokal | Automatisch für bekannte Apps, Upload | MDI, Upload | Iconify, Emoji, URL, lokal |
| Icon-Farbe anpassbar | ✅ | ✅ | ✅ (Kachelfarbe) | ❌ | ✅ (+ Hintergrund, Wrap) |
| Automatische Metadaten aus URL | ❌ | ◐ (Favicon) | ✅ (Website-Lookup) | ❌ | ❌ |
| Link-Ziel | ✅ (global/je Service) | ✅ (Tab, neuer Tab, Modal, Workspace, Zwischenablage) | ✅ | ✅ | ✅ |
| Lokale vs. externe URL automatisch | ❌ | ✅ (`localUrl` mit Erreichbarkeitsprüfung) | ❌ | ❌ | ❌ |
| Hotkeys je Eintrag | ❌ | ✅ (0–9) | ❌ | ❌ | ❌ |
| Papierkorb / Wiederherstellen | ❌ | ❌ | ✅ | ❌ | ❌ |
| Eigene IDs für CSS/JS | ✅ | ✅ | ❌ | ❌ | ❌ |

### Suche

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Lokale Suche über Einträge | ✅ (Quick Launch, einfach lostippen) | ✅ (Name, Domain, Tags, Aliase) | ✅ (Provider „Tiles“) | ✅ | ❌ |
| Websuche | ✅ (inkl. Vorschläge) | ✅ (inkl. Bangs) | ✅ (Google, Bing, DDG u. a.) | ✅ (11 Anbieter, Präfixe wie `/g`) | ❌ |
| Eigene Suchmaschinen | ✅ | ✅ | ✅ (YAML) | ✅ | ❌ |
| URL direkt öffnen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tastaturnavigation | ✅ | ✅ | ◐ | ◐ | ❌ |

### Monitoring & Integrationen

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| HTTP-Statusprüfung | ✅ (siteMonitor mit Antwortzeit) | ✅ (Statuscodes, Header, Redirects, Intervall) | ❌ | ❌ | ✅ (Intervall, Animation) |
| ICMP-Ping | ✅ | ✅ | ❌ | ❌ | ❌ |
| Status-Stil wählbar | ✅ (Punkt, UP/DOWN, ms) | ✅ (farbenblind-freundlich) | – | – | ◐ |
| Service-Widgets mit Live-Daten | ✅ (165) | ✅ (\~50 Self-Hosted-Widgets) | ✅ (Enhanced Apps) | ❌ | ◐ (2: Wetter, IP) |
| Info-/Allgemein-Widgets | ✅ (13) | ✅ (\~40) | ❌ | ◐ (Wetter) | ◐ |
| Systemressourcen (CPU, RAM, Disk) | ✅ (Resources, Glances) | ✅ (Glances, \~15 Widgets) | ❌ | ❌ | ❌ |
| Docker-Containerstatus/-Statistiken | ✅ (CPU, RAM, Netz) | ❌ | ❌ | ◐ (stoppte Apps lösen) | ❌ |
| Auto-Discovery über Docker-Labels | ✅ (inkl. Swarm, mehrere Hosts, TLS, Socket-Proxy) | ❌ | ❌ | ✅ | ❌ |
| Kubernetes-Discovery | ✅ (Ingress, Traefik IngressRoute, Gateway API) | ❌ | ❌ | ✅ (Ingress-Annotations) | ❌ |
| Proxmox-VM/LXC-Statistiken | ✅ | ✅ (Proxmox-Listen) | ❌ | ❌ | ❌ |
| Generischer API-Widget | ✅ (Custom API) | ✅ (API Response, Data Feed) | ❌ | ❌ | ❌ |
| Prometheus | ✅ | ✅ | ❌ | ❌ | ❌ |
| iFrame / HTML-Embed | ✅ | ✅ | ❌ | ❌ | ❌ |
| Kalender (iCal, \*arr) | ✅ | ✅ | ❌ | ❌ | ❌ |
| RSS/Atom-Feed | ✅ | ✅ | ❌ | ❌ | ❌ |
| Wetter | ✅ (OpenWeatherMap, Open-Meteo) | ✅ (inkl. Vorhersage) | ❌ | ✅ (WeatherAPI) | ✅ (OpenWeatherMap) |
| Schwellwert-Hervorhebung | ✅ (Regeln: good/warn/danger) | ◐ (Resource-Alerts) | ❌ | ❌ | ❌ |
| Feldauswahl je Widget | ✅ | ◐ | ❌ | ❌ | ❌ |
| API-Requests serverseitig (Keys versteckt) | ✅ | ◐ (optional per Proxy) | ✅ | – | ✅ |
| Eigene HTTP-Header für Widgets | ✅ | ✅ | ❌ | ❌ | ❌ |

### Benutzer & Sicherheit

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Login | ✅ (Passwort, optional) | ✅ (Built-in) | ✅ | ✅ (ein Passwort, JWT) | ❌ |
| OIDC / SSO | ✅ (inkl. Auto-Login) | ✅ (OIDC, Keycloak, Header-Auth) | ❌ | ❌ | ❌ |
| Mehrere Benutzer | ❌ | ✅ (mit Rollen/Gruppen) | ✅ (eigene Dashboards je Nutzer) | ❌ | ❌ |
| Sichtbarkeit je Nutzer/Gruppe/Rolle | ❌ | ✅ (show/hideFor…) | ✅ (pro Nutzer) | ◐ (öffentlich/privat je Eintrag) | ❌ |
| Gastzugang | ❌ | ✅ | ✅ (öffentliche Startseite, Auto-Login-Link) | ✅ (öffentliche Einträge) | – |
| Host-Header-Prüfung | ✅ (`HOMEPAGE_ALLOWED_HOSTS`) | ❌ | ❌ | ❌ | ❌ |
| Indexierung durch Suchmaschinen sperren | ✅ | ◐ | ❌ | ❌ | ◐ (robots.txt) |

### Betrieb & Sonstiges

| Feature | Homepage | Dashy | Heimdall | Flame | Mafl |
| --- | --- | --- | --- | --- | --- |
| Docker-Image | ✅ (amd64, arm64) | ✅ | ✅ (linuxserver.io, multi-arch) | ✅ (multi-arch) | ✅ |
| Kubernetes-Anleitung | ✅ | ✅ | ❌ | ✅ (Skaffold) | ❌ |
| Weitere Plattformen | Unraid, Quelle | Bare Metal, Netlify/Vercel u. a. (statisch) | Bare Metal (PHP) | Bare Metal | Proxmox-Skript, Unraid, Portainer |
| Sprachen (i18n) | 40+ (Crowdin) | 30+ | 22 | ❌ (nur Englisch) | 11 |
| Logging mit Rotation | ✅ | ✅ | ◐ | ◐ | ◐ |
| Mehrere Instanzen unterscheiden | ✅ (`instanceName`) | ❌ | ❌ | ❌ | ❌ |

## Homepage im Detail

Modernes, sehr integrationsstarkes Dashboard (Next.js). Konfiguration rein über YAML-Dateien: `settings.yaml`, `services.yaml`, `bookmarks.yaml`, `widgets.yaml`, `docker.yaml`, `kubernetes.yaml`, `proxmox.yaml`, `custom.css`, `custom.js`.

- **Services:** Gruppen (beliebig verschachtelt), Beschreibung, Icon, `href`, Link-Ziel, `ping` (ICMP), `siteMonitor` (HTTP HEAD/GET mit Antwortzeit), Docker-Container-Bindung (`server`/`container`, ausklappbare CPU/RAM/Netz-Statistiken), Proxmox-VM/LXC-Bindung, eigene `id` für CSS.
- **Service-Widgets (165):** u. a. \*arr-Stack, Plex/Jellyfin/Emby, Downloader (qBittorrent, SABnzbd …), Netzwerk (Pi-hole, AdGuard, OPNsense, pfSense, UniFi, Omada, MikroTik, FRITZ!Box, OpenWrt), Infrastruktur (Proxmox, PBS, TrueNAS, Unraid, Synology, QNAP, Portainer, Komodo, Traefik, Caddy, NPM, Cloudflared, Tailscale, Headscale, NetBird), Monitoring (Uptime Kuma, Gatus, Healthchecks, Netdata, Glances, Prometheus, Zabbix, Checkmk, Grafana, Beszel, Scrutiny), Smart Home (Home Assistant, ESPHome, Homebridge, Frigate, evcc, OpenDTU), Produktivität (Nextcloud, Paperless, Immich, Mealie, Vikunja, Firefly), dazu Custom API, iFrame, Kalender, Feed, MJPEG, Prometheus-Metrik.
- **Widget-Optionen:** mehrere Widgets pro Service, Feldauswahl (`fields`), eigene HTTP-Header, Hervorhebung nach Regeln (numerisch: gt, gte, lt, lte, eq, ne, between, outside; Text: equals, includes, startsWith, endsWith, regex; Negation, nur Wert einfärben), zentrale `providers` für geteilte API-Keys, Fehlermeldungen ausblendbar.
- **Info-Widgets (Kopfzeile):** Datum/Uhrzeit, Begrüßung, Logo, Suche, Ressourcen (CPU, RAM, Disk, Temperatur, Uptime), Glances, Kubernetes, Longhorn, OpenWeatherMap, Open-Meteo, Aktien, UniFi, Custom API. Info-Widgets können verlinkt werden.
- **Discovery:** Docker-Labels (`homepage.*`, auch Swarm), mehrere Docker-Hosts per Socket, TCP, TLS-Zertifikat oder Socket-Proxy; Kubernetes-Ingress, Traefik IngressRoute, Gateway API HTTPRoute.
- **Layout:** Spalten- oder Zeilenlayout je Gruppe, Tabs (per `#tab` verlinkbar), Kategorie-Icons, Header ausblendbar, Full Width, max. Spaltenzahl, einklappbare und initial eingeklappte Gruppen, gleich hohe Karten, Icon-only-Bookmarks.
- **Optik:** Hell/Dunkel, 22 Farbpaletten, Hintergrundbild mit Blur/Sättigung/Helligkeit/Opazität, Card-Blur, 4 Header-Stile, Card-Stil „hairline“, Block-Stil „refined“, Schriften Manrope oder IBM Plex Mono (auch nur für Daten), Icon-Stil Verlauf oder Theme, Favicon, Status-Stil (Punkt, UP/DOWN, ms).
- **Quick Launch:** einfach lostippen; durchsucht Services (optional Beschreibungen), Websuche mit Vorschlägen, URL direkt öffnen, mobiler Button.
- **Sicherheit:** API-Proxy (Keys bleiben serverseitig), Host-Header-Allowlist, optionales Passwort- oder OIDC-Login (Auto-Login), Log-Hinweis für fail2ban/CrowdSec, `noindex`.
- **MCP-Endpunkt (`/api/mcp`):** Config-Dateien auflisten, lesen, validieren; optional schreiben, Service hinzufügen, Info-Widget hinzufügen; Doku-Links. Token-Auth, standardmäßig read-only.
- **Betrieb:** PWA (Icons, Shortcuts), 40+ Sprachen, Versionsanzeige und Update-Check, Log-Rotation (10 MiB × 5), `instanceName` für mehrere Instanzen, Base-URL für Reverse-Proxy-Unterpfade.
- **Fehlt:** UI-Editor, Multi-User, Drag-and-drop.

## Dashy im Detail

Der funktionsreichste Allrounder (Vue). Single-File-YAML (`conf.yml`), aber vollständig im UI editierbar.

- **Konfiguration:** Interaktiver Edit-Mode (Klick auf jedes Element, Live-Vorschau, Speichern auf Disk oder lokal), Roh-Editor, JSON-Schema für IDE-Validierung, Export, Konfigurationssperre (`preventWriteToDisk`, `preventLocalSave`, `disableConfiguration`, nur Admins).
- **Mehrseitig:** lokale und Remote-Unterseiten (Config per URL einbinden), eigene URL-Struktur.
- **Ansichten:** Default, Workspace (Seitenleiste + Apps im iFrame, Multitasking), Minimal (schnelle Startseite mit Tabs).
- **Öffnen:** gleicher Tab, neuer Tab, `top`, Modal (verschiebbar, skalierbar), Workspace, Zwischenablage; Kontextmenü und Tastenkürzel für alternative Methoden.
- **Items:** Titel, Beschreibung, URL, `localUrl` (LAN-Adresse wird bevorzugt, wenn erreichbar), Icon, Hotkey 0–9, Alias, Tags, Sub-Items, Farbe/Hintergrund, `hideFromHomepage` (nur per Suche), Sichtbarkeit nach Nutzer/Gruppe/Rolle/Gast.
- **Sektionen:** Icon, Sortierung, eingeklappt, Höhe begrenzen, Zeilen/Spalten-Span, Item-Größe, eigene Styles, Grid-Layout je Sektion.
- **Statusprüfung:** HTTP (eigene URL, Header, akzeptierte Codes, Redirects, unsicheres TLS), ICMP-Ping (Anzahl, Timeout), Intervall, farbenblind-freundliche Darstellung.
- **Suche:** sofort beim Tippen, nach Name/Domain/Tags/Aliassen, Tastaturnavigation, Websuche mit Bangs und eigener Suchmaschine, URLs direkt öffnen, Suche aus der Adressleiste.
- **Widgets (\~96 Komponenten):** Allgemein: Uhr, Wetter + Vorhersage, RSS, Kalender, Bild, öffentliche IP, IP-Blacklist, Domain-Monitor, Krypto, Aktien, Wechselkurse, Feiertage, Sport, News, ÖPNV (TfL, MVG), Flugdaten, NASA APOD, GitHub, Hacker News, XKCD, Witze, Minecraft-Server, Custom Search. Self-Hosted: Pi-hole (v5/v6), AdGuard, Nextcloud (6 Widgets), Proxmox, Uptime Kuma, Healthchecks, Gluetun, ntfy, Sabnzbd, Synology DS, Drone CI, Filebrowser, Linkding, Tactical RMM. System (Glances): CPU aktuell/je Kern/Verlauf, RAM, Disk-Platz, Disk-IO, Load, Netzwerk, Temperaturen, GPU, Ressourcen-Alarme. Dynamisch: iFrame, HTML-Embed, API Response, Prometheus, Data Feed. Optionen: Update-Intervall, Proxy, Timeout, Fehler ignorieren, Labels, Chart-Anpassung.
- **Theming:** \~40 eingebaute Themes, Tag/Nacht-Theme nach OS, UI-Farbeditor, eigene Themes (nur Farben oder ganze CSS-Datei), Custom CSS im UI, seitenspezifische Styles, externe Stylesheets, CSS-Variablen, Typografie.
- **Icons:** Favicon automatisch (verschiedene APIs), Font Awesome, Simple Icons, generative Icons, Emoji, selfh.st, Homelab-Icons, MDI, URL, lokal, Standard-Icon, Icon-Farbe.
- **Auth:** Built-in (Nutzer mit Hash, Admin/Normal), Keycloak, Header-Auth (Authelia, Authentik usw.), OIDC (Anleitungen für Authentik, Authelia, Zitadel, Pocket ID), Gastzugang, Basic-Auth serverseitig.
- **Backup:** Ende-zu-Ende-verschlüsseltes Cloud-Backup/-Restore, Backup-Server selbst hostbar (Cloudflare Worker).
- **REST-API:** Lesen/Schreiben der Config, einzelner Sektionen und Items; Auth über vorhandene Anmeldung oder `API_TOKEN`.
- **Sonstiges:** Navbar-Links, HTML-Footer, Logo, Splash-Screen, PWA/Service Worker, 30+ Sprachen, Healthcheck, SSL im Container, statisches Hosting möglich, Sentry-Fehlerreporting optional, ausführliche Privacy- und Threat-Model-Doku.
- **Fehlt:** Docker-/Kubernetes-Discovery, Container-Statistiken.

## Heimdall im Detail

Klassischer, sehr einfacher App-Launcher (PHP/Laravel, SQLite). Keine Config-Dateien, alles im Web-UI.

- **Apps:** Titel, URL, Farbe, Icon, Beschreibung; bekannte Apps werden beim Tippen des Namens erkannt („Foundation Apps“ mit Icon und Farbe, mehrere hundert).
- **Enhanced Apps:** App-spezifische API-Konfiguration mit Live-Statistiken auf der Kachel (z. B. NZBGet/SABnzbd-Queue und Downloadrate), „Test config“-Button, App-Liste wird vom Server aktualisiert.
- **Website-Lookup:** Metadaten und Icon automatisch aus der URL (rate-limitiert).
- **Organisation:** Tags, wahlweise als Ordner, Tags oder Kategorien dargestellt; Standard-Tag; Anheften auf die Startseite; Drag-and-drop-Sortierung; Papierkorb mit Wiederherstellen.
- **Mehrbenutzer:** eigene Dashboards und Einstellungen je Nutzer, Benutzerauswahl-Bildschirm, optional Passwort je Nutzer, öffentliche Startseite, Auto-Login-Link (UUID).
- **Suche:** Suchleiste auf der Startseite, Anbieter frei per `searchproviders.yaml` (Tiles = lokale Suche, Google, Bing, DuckDuckGo, Startpage, Baidu …), Autocomplete.
- **Optik:** Hintergrundbild (Upload) oder generierter Trianglify-Hintergrund mit Seed, Custom CSS, Custom JS, Link-Ziel.
- **Daten:** JSON-Import/Export, REST-Endpunkt für Items, Health-Endpunkt.
- **Sonstiges:** 22 Sprachen, TLS-Prüfung abschaltbar, Docker-Image von linuxserver.io (x86-64, armhf, arm64).
- **Fehlt:** Statusprüfung, Widgets außerhalb der Enhanced Apps, Docker-Discovery, SSO.

## Flame im Detail

Startseite im Stil von SUI (Node/Express + React, SQLite). Alles per GUI-Editor, keine Dateibearbeitung nötig. Letzter Commit April 2026, Entwicklung eher ruhig.

- **Apps und Bookmarks:** getrennte Bereiche; Bookmarks in Kategorien; Erstellen, Bearbeiten, Löschen im UI; Anheften auf die Startseite (Standard einstellbar); Sortierung nach Erstelldatum, Name oder manuell per Drag-and-drop; öffentlich/privat je Eintrag; Beschreibung; Icons aus Material Design Icons oder eigener Upload.
- **Docker-Integration:** Apps automatisch aus Labels (`flame.type`, `flame.name`, `flame.url`, `flame.icon`), mehrere Apps pro Container, entfernter Docker-Host, gestoppte Apps automatisch lösen.
- **Kubernetes:** Apps aus Ingress-Annotations.
- **Suche:** lokale Filterung über Apps und Bookmarks, 11 Websuchanbieter mit Präfixen (z. B. `/g`, `/yt`, `/w`), eigene Suchanbieter, primärer und sekundärer Anbieter, Autofokus abschaltbar.
- **Header:** Begrüßung (eigene Grußformeln nach Tageszeit), Datum mit eigenen Tages- und Monatsnamen, optional Uhrzeit, US-Datumsformat.
- **Wetter-Widget:** WeatherAPI, Temperatur (°C/°F), Bewölkung oder andere Werte, animiertes Wettersymbol, Live-Update per WebSocket.
- **Theming:** 15 eingebaute Themes, eigener Theme-Builder, Custom CSS im UI.
- **Auth:** ein Passwort schützt Einstellungen und private Einträge (JWT mit Laufzeit), Docker Secrets über `*_FILE`.
- **Sonstiges:** Elemente ausblendbar (Header, Apps, Kategorien, Suche, Datum), Link-Ziel je Bereich, HTML-Bookmark-Import (experimentelles Python-Skript), Multi-Arch-Image.
- **Fehlt:** Statusprüfung, Service-Widgets, Multi-User, i18n.

## Mafl im Detail

Schlanke, schnelle Startseite (Nuxt 3). Eine einzige `config.yml`.

- **Services:** flache Liste oder Gruppen, Titel, Beschreibung, Link, Link-Ziel, Icon, Tags.
- **Icons:** Iconify (über 200.000 Icons), Emoji, URL oder lokal; Farbe, Hintergrund, „Wrap“ in eine Blase.
- **Tags:** global definiert mit 17 Farben.
- **Status:** HTTP-Statusprüfung je Service, Intervall, Animation, für alle URL-Typen.
- **Echtzeit:** Karten aktualisieren sich per WebSocket; Config-Änderungen laden die App automatisch neu.
- **Service-Typen:** Basis-Service, OpenWeatherMap (Wetter), IP-API (eigene IP mit Länderflagge). Alle Requests an Drittanbieter laufen im Backend, `secrets` gelangen nie in den Browser.
- **Layout:** Grid-Spalten je Breakpoint (small bis xlarge, 1–12).
- **Themes:** system, light, dark, deep, sepia, bluer.
- **Sonstiges:** 11 Sprachen (inkl. Deutsch), PWA, Update-Hinweis, Docker-Healthcheck, Vorlagen für Unraid/Portainer/Compose, Proxmox-Installationsskript.
- **Fehlt:** UI-Editor, Suche, Auth, Docker-Discovery, nennenswerte Widgets.

## Rackula im Detail (Rack-Designer)

Kein Dashboard, sondern ein Drag-and-drop-Designer für Server-Racks (Svelte 5, SVG). Relevant als Modul „physische Infrastruktur“ für das eigene Dashboard.

- **Racks:** beliebig viele pro Layout, 1–100 HE, Breiten 10", 19", 21", 23" maßstabsgetreu, Tiefe, Gewicht, Bauform, Notizen, Duplizieren, per Drag in der Höhe ändern, Reihenfolge ändern, Rack-Gruppen (bayed racks) mit gestapelten Reihen, U-Nummerierung umkehrbar, jede 5. HE hervorgehoben.
- **Geräte:** Drag-and-drop aus einer Gerätebibliothek mit echten Bildern (NetBox devicetype-library, Brand Packs u. a. Ubiquiti, Cisco, MikroTik, Dell, HPE, Netgear, FS.COM, DeskPi), eigene Geräte mit Kategorienfarben, Bildupload mit Zuschneiden, Front/Rear/beide Seiten, volle Tiefe belegt beide Seiten, Kollisionserkennung, Verschieben zwischen Racks, Favoriten, Fuzzy-Suche.
- **Carrier-Modell:** Halbbreite und Sub-HE-Geräte sitzen in Trägern (Shelves/Trays); Maße in mm/cm/Zoll, 90°-Drehung.
- **Ports und Verbindungen:** Port-Templates (Netzwerk, Strom, Konsole, Audio/AV wie XLR, TRS, HDMI, SDI, Dante), Richtung und Signaltyp, Verbindungen als Pfade auf dem Canvas, Warnung bei falschem Signaltyp, Patchbay-Normalling, Export als CSV-Patchliste.
- **Import/Export:** NetBox-Import und -Export von Gerätetypen, Speichern als YAML oder `.Rackula.zip` mit Bildern, Export als PNG, JPEG, SVG, PDF (vektor, AutoCAD-tauglich), Teilen per URL oder QR-Code, JSON-Schema für Layouts, YAML-Editor im UI.
- **Speicherung:** Browser-Storage mit Autosave oder optionale Server-API (Persistenz, Sync zwischen Geräten, Snapshots vor dem Überschreiben, Konfliktschutz, Quotas, Rate-Limiting), Layout-Bibliothek mit Vorschaubildern, Layout-Tabs.
- **Bedienung:** Command Palette (Ctrl+K), Tastaturkürzel für alles, Undo/Redo, Kontextleisten, Vorlagen für neue Racks, Mobile-Ansicht mit Touch-Gesten, Swipe, Haptik.
- **Auth:** keine, lokale Konten oder OIDC; API-Write-Token.
- **Sonstiges:** Hell/Dunkel (Dracula-Farben), WCAG-AA-Barrierefreiheit, reduzierte Bewegung, Docker, Proxmox-LXC, statisches Hosting.

## Schlussfolgerungen für Ultimate Dash

**Must-haves (von mehreren Lösungen etabliert):**

- Gruppen/Sektionen mit Icons, Beschreibungen und flexiblen Icon-Quellen (Dashboard Icons, selfh.st, MDI, Simple Icons, Iconify, Emoji, Upload)
- HTTP-Statusprüfung und ICMP-Ping mit Antwortzeit
- Lokale Suche plus Websuche mit Präfixen/Bangs, Tastaturbedienung
- Themes inkl. Hell/Dunkel, Custom CSS, Hintergrundbild
- Serverseitiger API-Proxy, damit Keys nie im Browser landen
- Docker-Image (multi-arch), Healthcheck, PWA, i18n

**Differenzierende Features, die man kombinieren sollte:**

- **Konfiguration als Code und UI zugleich:** YAML-Dateien wie bei Homepage, aber bidirektional im UI editierbar wie bei Dashy, mit Schema-Validierung und Hot Reload wie bei Mafl.
- **Auto-Discovery** aus Docker-Labels, Kubernetes und Proxmox (Homepage, Flame) mit Container-Statistiken.
- **Großer Widget-Katalog** mit Feldauswahl, Schwellwert-Hervorhebung und generischem API-/Prometheus-Widget (Homepage), dazu Dashys System-Widgets mit Verlaufsgrafiken.
- **Mehrere Ansichten:** Dashboard, Workspace mit eingebetteten Apps, Minimal-Startseite (Dashy).
- **Benutzer & Rechte:** Multi-User mit eigenen Dashboards (Heimdall) plus OIDC und Sichtbarkeit nach Gruppe/Rolle (Dashy).
- **`localUrl`-Umschaltung** zwischen LAN- und externer Adresse (Dashy).
- **Automatische Metadaten** aus einer URL (Heimdall) und bekannte-App-Erkennung.
- **API und MCP** für Automatisierung und KI-Assistenten (Dashy-API, Homepage-MCP).
- **Infrastruktur-Dokumentation:** Rack-Ansicht à la Rackula, idealerweise verknüpft mit den Live-Status-Daten der Services (z. B. Gerät im Rack zeigt Status und Auslastung).

**Lücken, die keine der Lösungen schließt:** Verlauf/Historie der Statusprüfungen, Benachrichtigungen bei Ausfällen (nur Dashy hat Ressourcen-Alarme), Verknüpfung zwischen physischer Hardware und laufenden Services, Netzwerk-Topologie.

# Änderungsprotokoll

Alle nennenswerten Änderungen pro Version. Der Abschnitt einer Version ist zugleich der Text der GitHub-Veröffentlichung und wird Admins in der Update-Prüfung vor der Installation angezeigt.

## [Unveröffentlicht]

## [1.1.0] – 2026-11-12

### Installation

- `install.sh migrate-docker` übernimmt Daten und Einstellungen einer Docker-Installation (siehe Installationsanleitung)

### Dashboard

- Fehler behoben: Im Bearbeiten-Modus überlappten Service-Kacheln benachbarte Gruppen, wenn Namen oder Adressen lang waren

## [1.0.0] – 2026-11-12

Erste offizielle Veröffentlichung.

### Dashboard

- Gruppen, Services und Bookmarks mit Icon-Auswahl, Tags, Drag-and-drop und YAML-Export/-Import
- Statusprüfung per HTTP mit Wiederholung per GET, wenn HEAD fehlschlägt; Gruppen lassen sich optional lückenlos anordnen
- Dashboard pro Benutzer, inklusive Kopieren aus anderen Dashboards
- Gruppenicons per Suche, einklappbarer DNS-Bereich, volle Seitenbreite, Burger-Menü für Netzwerk-Links
- Neuigkeiten per RSS: Seitenleiste mit Abruf und Cache im Server, Feed-Verwaltung für Admins, 40 vorbelegte Feeds
- Version im Menü und auf dem Homescreen

### Anmeldung und Benutzer

- Lokale Benutzer mit Rollen „Admin“ und „Benutzer“, optional Anmeldung per OIDC
- Benutzerverwaltung und „Passwort vergessen“ mit Einmal-Links, optional per Mail
- Mailserver (SMTP) lässt sich in den Einstellungen einrichten und testen

### DNS, DHCP und IPAM (Technitium)

- DNS-Statistik und Blocking auf dem Dashboard
- DNS-Zonen und Records ansehen, anlegen, ändern und löschen
- DHCP: Scopes, Leases und Reservierungen, auch von mehreren Technitium-Servern
- IPAM mit Netzen, Kategorien und IP-Bereichen, Belegung live aus Technitium, Abgleich von Netzen und DHCP-Pools
- Ping-Prüfung mit entdeckten Geräten, Hersteller aus der MAC-Adresse
- IP-Ansicht mit Seitenfenster und Aktionen, Assistent „Neue IP“, Suche, Filter und gespeicherte Ansichten
- Statistik je Netz mit Kacheln, Summenzeile und Verlauf
- Konsistenzhinweise zwischen DHCP und DNS mit Behebung per Klick, Bereich „Netzwerk“ mit Protokoll-Ansicht

### Weitere Anbindungen (rein lesend)

- Proxmox VE: Auslastung als Balken oder kompakt, Hinweise bei fehlenden Rechten
- Zoraxy: Proxy-Hosts, Zertifikate, Uptime und Anfragen (noch nicht gegen eine echte Instanz getestet)

### Betrieb und Updates

- Einstellungen-Menü mit Admin, Verbindungen und Backup
- Docker Compose und Installationsskript `install.sh` für Ubuntu/Debian (systemd-Dienst, Backups, Reparatur, Updates)
- Update-Prüfung gegen GitHub-Veröffentlichungen unter Einstellungen › Updates, Installation aus der Oberfläche bei `install.sh`-Installationen nach ausdrücklicher Bestätigung des Änderungsprotokolls (bei Docker nur Anzeige); die Installation über systemd wurde noch nicht auf einem echten Host getestet

### Projekt

- MIT-Lizenz, rechtliche Hinweise, Anleitungen, Issue-Vorlagen und `CONTRIBUTING.md`

[1.1.0]: https://github.com/myrillian/ultimate-dash/releases/tag/v1.1.0
[1.0.0]: https://github.com/myrillian/ultimate-dash/releases/tag/v1.0.0

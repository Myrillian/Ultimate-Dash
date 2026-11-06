# Entscheidungen

> Getroffen am 05.11.2026 von Matthias. Neue Entscheidungen werden unten angehängt.

| # | Thema | Entscheidung | Begründung / Hinweise |
| --- | --- | --- | --- |
| 1 | Konfiguration | SQLite-Datei als Speicher, Bearbeitung im UI, YAML-Export/Import | Vorgabe: Datenbank nur, wenn nötig. Sie ist nötig, weil UI-Editor, IPAM-Daten (Netze, Gruppen, Bereiche), Änderungsprotokoll und gleichzeitige Schreibzugriffe mit reinen YAML-Dateien fehleranfällig werden (Kommentare gehen beim Zurückschreiben verloren, keine Transaktionen). SQLite ist trotzdem die einfachste Form: eine Datei in `/data`, kein eigener Datenbankserver, Backup durch Kopieren. |
| 2 | Tech-Stack | Durchgängig TypeScript: SvelteKit (SPA) im Frontend, Fastify im Backend, gemeinsames Paket für Typen und Validierung (Zod) | |
| 3 | Benutzer | Lokaler Admin plus optional OIDC, Rollen „Admin“ und „Nur lesen“ | |
| 4 | Reihenfolge | Erst Kern-Dashboard, dann IPAM | Schwerpunkt auf Performance und guter Bedienbarkeit nach Best Practices (Barrierefreiheit, Tastaturbedienung, schnelle Ladezeiten, mobile Nutzung). |
| 5 | DHCP | Technitium ist DNS- und DHCP-Server | Das IPAM kann Leases, Reservierungen und Scopes vollständig verwalten. |
| 6 | Infrastruktur-Module | Rack-Ansicht und Switch-Management später als eigene Module | Switch-Management: Switches, Ports und deren Belegung verwalten (siehe Architektur, Phase 4). |
| 7 | Repo | Vorerst privat, Open Source eventuell später | Lizenz wird bei Veröffentlichung entschieden. |
| 8 | Technitium-Zugang | API-Token in der SQLite-Datei (oder per Umgebungsvariable), Aufrufe nur über das Backend, kurzer Zwischenspeicher (15 s) | Das Token verlässt den Server nie. Mehrere offene Dashboards teilen sich einen Abruf, damit Technitium nicht unnötig belastet wird. Das Token wird als `Authorization: Bearer` (ab Version 15) und zusätzlich als Formularfeld `token` (ältere Versionen) geschickt, per POST, damit es nicht in Zugriffslogs auftaucht. Empfehlung: eigener Technitium-Benutzer mit nur den nötigen Rechten. Getroffen am 06.11.2026 (Claude, im Rahmen der Freigabe für Phase 2). |
| 9 | Änderungsprotokoll | Jede schreibende Aktion an Technitium wird in der Tabelle `audit_log` mit Benutzer, Zeit, Aktion und Ergebnis gespeichert, ein Jahr lang | Grundlage für die spätere Protokoll-Ansicht im IPAM. Fehlgeschlagene Versuche werden ebenfalls festgehalten. |

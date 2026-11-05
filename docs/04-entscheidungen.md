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

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

| Variable                  | Standard | Bedeutung                              |
| ------------------------- | -------- | -------------------------------------- |
| `PORT`                    | `3000`   | HTTP-Port                              |
| `DATA_DIR`                | `./data` | Ordner für die SQLite-Datenbank        |
| `STATUS_INTERVAL_SECONDS` | `60`     | Abstand der Statusprüfungen            |
| `STATUS_TIMEOUT_MS`       | `5000`   | Zeitlimit pro Statusprüfung            |
| `LOG_LEVEL`               | `info`   | `debug`, `info`, `warn`, `error`       |
| `LOG_REQUESTS`            | `false`  | Jede HTTP-Anfrage loggen               |
| `TECHNITIUM_URL`          | –        | Feste Technitium-Adresse (siehe unten) |
| `TECHNITIUM_TOKEN`        | –        | API-Token dazu                         |

## Anmeldung und Benutzer

Beim ersten Aufruf legst du im Browser ein Administrator-Konto an. Danach ist das Dashboard nur nach der Anmeldung erreichbar.

- **Administrator**: darf alles bearbeiten und Benutzer verwalten (Einstellungen oben rechts → _Admin › Benutzer verwalten_).
- **Benutzer**: darf das eigene Dashboard bearbeiten, in IPAM, DHCP und DNS aber nichts ändern.

In der Benutzerverwaltung legen Admins Benutzer an, ändern ihre Rolle und E-Mail-Adresse, setzen ein neues Passwort oder erzeugen einen Reset-Link und löschen Benutzer. Der letzte Admin lässt sich weder löschen noch herabstufen.

**Dashboard pro Benutzer:** Jeder hat sein eigenes Dashboard (Gruppen, Services, Reihenfolge, Titel). Neue Benutzer starten leer; das bisherige Dashboard gehört dem ersten Administrator. Über _Von anderem Benutzer kopieren_ (Einstellungen › _Backup_ oder Startseite) wählst du per Checkbox Gruppen und Services aus dem Dashboard eines anderen Benutzers; sie werden als unabhängige Kopie übernommen, Gruppen gleichen Namens ergänzt, gleichnamige Services übersprungen. Wer dieselbe Adresse mehrfach hat, wird nur einmal geprüft. IPAM, DNS und DHCP sind für alle gleich.

Passwörter werden mit scrypt gespeichert, Sitzungen laufen 30 Tage und verlängern sich bei Nutzung. Nach zehn Fehlversuchen in 15 Minuten wird die Anmeldung für diesen Benutzernamen und diese IP kurz gesperrt. Hinter einem Reverse-Proxy mit HTTPS wird das Cookie automatisch als `Secure` gesetzt, wenn der Proxy `X-Forwarded-Proto` mitsendet.

### Passwort vergessen

Auf der Anmeldeseite gibt es _Passwort vergessen?_. Was dann passiert, hängt davon ab, ob ein Mailserver eingerichtet ist:

- **Mit SMTP** (siehe unten) und hinterlegter E-Mail-Adresse bekommt der Benutzer einen Link, der eine Stunde gültig ist und nur einmal funktioniert.
- **Ohne SMTP** oder ohne Adresse sehen die Admins die Anfrage in der Benutzerverwaltung. Dort erzeugen sie einen Reset-Link (24 Stunden gültig) und geben ihn selbst weiter, oder sie setzen direkt ein neues Passwort.

Die Seite antwortet immer gleich, damit sich darüber keine Benutzernamen ausforschen lassen. Nach dem Zurücksetzen ist der Benutzer auf allen anderen Geräten abgemeldet. Die eigene E-Mail-Adresse pflegt jeder im Benutzermenü.

| Variable            | Standard            | Bedeutung                                                                   |
| ------------------- | ------------------- | --------------------------------------------------------------------------- |
| `SMTP_HOST`         |                     | Mailserver; ohne diesen Wert ist der Mailversand aus                        |
| `SMTP_PORT`         | `587`               | Port                                                                        |
| `SMTP_SECURE`       | `true` bei Port 465 | Direkt per TLS verbinden; sonst STARTTLS, wenn der Server es anbietet       |
| `SMTP_USER`         |                     | Benutzername am Mailserver                                                  |
| `SMTP_PASSWORD`     |                     | Passwort dazu                                                               |
| `SMTP_FROM`         |                     | Absender, z. B. `Ultimate Dash <dash@example.org>` (Pflicht mit SMTP)       |
| `SMTP_TLS_INSECURE` | `false`             | Selbstsignierte Zertifikate am Mailserver akzeptieren                       |
| `PUBLIC_URL`        |                     | Adresse des Dashboards für Links in Mails, z. B. `https://dash.example.org` |

`PUBLIC_URL` ist mit SMTP Pflicht, weil Links in Mails sonst aus dem `Host`-Header gebaut würden, den ein Angreifer fälschen kann.

**Einziger Admin ausgesperrt?** Einen Reset-Link auf der Kommandozeile erzeugen und im Browser öffnen:

```sh
docker exec -u node ultimate-dash node dist/main.js reset-link admin
```

Ist `PUBLIC_URL` nicht gesetzt, enthält der Link einen Platzhalter für die Adresse. `-u node` sorgt dafür, dass die Datenbankdateien dem richtigen Benutzer gehören.

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
| `OIDC_ADMIN_GROUPS`     |                        | Kommagetrennt. Mitglieder werden Admin, alle anderen „Benutzer“; wird bei jeder Anmeldung abgeglichen                                  |
| `OIDC_ALLOWED_GROUPS`   |                        | Kommagetrennt. Nur Mitglieder dürfen sich anmelden                                                                                     |
| `OIDC_AUTO_CREATE`      | `true`                 | Unbekannte Konten beim ersten Login anlegen; bei `false` werden nur bereits verknüpfte Konten angemeldet                               |
| `OIDC_LINK_BY_USERNAME` | `false`                | Erste SSO-Anmeldung mit einem gleichnamigen lokalen Benutzer verbinden (nur, wenn Benutzernamen beim Anbieter nicht frei wählbar sind) |
| `OIDC_TLS_INSECURE`     | `false`                | Selbstsignierte Zertifikate des Anbieters akzeptieren                                                                                  |

Konten werden über den `sub`-Claim des Anbieters zugeordnet, eine Umbenennung dort ist also unproblematisch. Ohne `OIDC_ADMIN_GROUPS` werden neue SSO-Benutzer mit der Rolle „Benutzer“ angelegt, und ein Admin vergibt die Rolle in der Benutzerverwaltung. Damit der letzte Admin sich nicht aussperrt, wird er durch fehlende Gruppen nie herabgestuft. Abmelden beendet nur die Sitzung im Dashboard, nicht die beim Anbieter.

## Icons

Im Icon-Feld eines Services oder einer Gruppe:

- `di:proxmox` für [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons)
- `sh:technitium` für [selfh.st Icons](https://selfh.st/icons/)
- `mdi:server` oder `simple-icons:proxmox` für alle [Iconify](https://icon-sets.iconify.design/)-Sets
- eine Bild-URL

Ohne Icon zeigt das Dashboard farbige Initialen.

Über **Durchsuchen** im Formular öffnet sich eine Liste aller Dashboard Icons und selfh.st Icons (rund 12.000) mit Suchfeld; Material Design Icons und Simple Icons werden beim Tippen über Iconify gesucht. Die Icon-Listen lädt der Server einmal täglich von jsDelivr (Ausweichquelle: GitHub) und legt sie unter `/data/cache` ab, damit die Auswahl auch bei Ausfällen funktioniert. Icons, die es nur als PNG gibt, tragen die Endung im Namen (z. B. `di:beispiel.png`).

## Bedienung im Bearbeiten-Modus

- **Verschieben:** Gruppen und Services am Griff (⠿) ziehen, Services auch in andere Gruppen. Per Tastatur: Griff fokussieren, Leertaste, Pfeiltasten, Leertaste. Auf Touchgeräten kurz gedrückt halten.
- **Tags:** aus den bereits verwendeten Tags wählen oder neue eingeben und mit Enter übernehmen.

## Export und Import

Unter Einstellungen › _Backup_ lässt sich das eigene Dashboard als YAML herunterladen und wieder einlesen. Vor dem Import zeigt eine Vorschau, was angelegt, aktualisiert oder entfernt wird.

- **Zusammenführen:** Gruppen und Services mit gleichem Namen werden aktualisiert, neue ergänzt, nichts gelöscht.
- **Ersetzen:** alles Bestehende wird durch die Datei ersetzt.

```yaml
version: 1
title: Mein Homelab
groups:
  - name: Infrastruktur
    services:
      - name: Proxmox
        url: https://pve.home.lan:8006
        icon: di:proxmox
        tags: [vm, homelab]
      - name: Technitium
        url: http://10.10.0.53:5380
        icon: sh:technitium
        statusCheck: false
```

Weitere Felder pro Service: `description`, `target` (`_blank` oder `_self`), `statusUrl`; pro Gruppe: `icon`, `collapsed`. Benutzer und Passwörter sind nicht Teil der Datei.

## Technitium DNS

Ist Technitium verbunden, zeigt das Dashboard oben einen DNS-Bereich: Anfragen, Geblockt, Cache-Anteil und Clients, den Verlauf (auch als Tabelle), woher die Antworten kamen, sowie Top-Domains, geblockte Domains und Top-Clients. Der Zeitraum (1 Stunde bis 1 Jahr) gilt für alles darin. Admins können das Blocking für 5, 15 oder 60 Minuten pausieren, dauerhaft aus- und wieder einschalten und die Blocklisten sofort aktualisieren. Jede dieser Änderungen landet mit Benutzer und Zeitpunkt im Änderungsprotokoll.

**Einrichten:** Einstellungen › _Verbindungen › Technitium DNS_, Adresse der Weboberfläche (z. B. `http://10.10.0.53:5380`) und ein API-Token eintragen. Das Token erzeugst du in Technitium unter _Administration › Sessions › Create Token_, am besten für einen eigenen Benutzer. Für die Statistik genügt die Berechtigung _Dashboard: View_, für das Blocking zusätzlich _Settings: Modify_. Gespeichert wird nur, wenn die Verbindung klappt.

Das Token bleibt auf dem Server (in der SQLite-Datei) und wird nie an den Browser geschickt. Alle Anfragen an Technitium laufen über das Backend. Wer die Verbindung lieber fest vorgibt, setzt `TECHNITIUM_URL` und `TECHNITIUM_TOKEN` (optional `TECHNITIUM_TLS_INSECURE=true` bei selbst signiertem Zertifikat); dann ist sie in der Oberfläche nur lesbar.

### Zonen und Records

Über „Zonen und Records ›“ im DNS-Bereich (oder `/dns`) lassen sich alle Zonen und ihre Einträge ansehen, durchsuchen und nach Typ filtern. Namen erscheinen relativ zur Zone (`nas` statt `nas.home.lan`, `@` für die Zone selbst). Admins können Einträge der Typen A, AAAA, CNAME, PTR, MX, TXT, NS und SRV anlegen, ändern (auch umbenennen, TTL, Kommentar, deaktivieren) und löschen. Andere Typen werden nur angezeigt. Bei A und AAAA lässt sich der passende PTR-Eintrag gleich mit anlegen; fehlt die Reverse-Zone, erstellt Technitium sie dabei. Interne Zonen von Technitium sind schreibgeschützt. Das API-Token braucht dafür die Zonen-Rechte _View_ und _Modify_ beziehungsweise _Delete_. Jede Änderung steht im Änderungsprotokoll.

### DHCP

Unter `/dhcp` (Link „DHCP ›“ im DNS-Bereich) zeigt Ultimate Dash alle Scopes mit Bereich, Gateway, Domain, Leasedauer, Ausnahmen und Belegung (dynamische Leases im Verhältnis zu den verteilbaren Adressen), dazu alle Leases und Reservierungen mit Suche und Scope-Filter. Admins können:

- Scopes aktivieren und deaktivieren
- dynamische Leases in Reservierungen umwandeln, Reservierungen wieder aufheben und Leases freigeben oder löschen
- Reservierungen anlegen, ändern und löschen (MAC, IP, Hostname, Kommentar)

Technitium kennt kein „Reservierung ändern“. Ultimate Dash entfernt dafür die alte und legt die neue an. Schlägt das Anlegen fehl (zum Beispiel, weil die IP schon vergeben ist), wird die alte Reservierung wiederhergestellt. Scopes selbst lassen sich hier noch nicht anlegen oder bearbeiten, das geht weiter in Technitium. Das API-Token braucht die Rechte _DhcpServer: View_, _Modify_ und _Delete_. Alle Änderungen stehen im Änderungsprotokoll.

Zum Ausprobieren ohne echten Server gibt es eine Simulation: `pnpm --filter @ultimate-dash/server fake:technitium` startet sie auf Port 5380 mit dem Token `dev-token`.

## IPAM

Unter **IPAM** (Umschalter neben DNS und DHCP) verwaltest du deine Netze:

- **Netze** mit Adressbereich (z. B. `10.10.10.0/24`, Präfix /16 bis /30), VLAN, Gateway und Beschreibung. Netze dürfen sich nicht überschneiden.
- **Kategorien** wie „Server“, „Clients“ oder „IoT“ mit einer Farbe. Sie dienen nur der Anzeige.
- **IP-Bereiche**: Jedes Netz wird in Bereiche je Kategorie eingeteilt. Bereiche liegen im Netz und überschneiden sich nicht.
- **Belegung** kommt live aus Technitium: DHCP-Leases, Reservierungen und DNS-A-Einträge. Das Raster (bis /22) zeigt jede Adresse farbig nach Kategorie, mit Zustand belegt, reserviert, DHCP-Pool, frei oder Konflikt (zwei Geräte beanspruchen dieselbe IP). Es ist per Pfeiltasten bedienbar, die Liste darunter nennt alle belegten Adressen mit Name, Quelle und MAC.

**Abgleich mit Technitium:** Hat ein DHCP-Scope noch kein Netz im IPAM, bietet die Netzübersicht (für Admins) an, es zu übernehmen. Name, Netz, Gateway und Domäne kommen aus Technitium; auf Wunsch wird der verteilbare Bereich (Scope-Bereich ohne Ausschlüsse) als Bereich der Kategorie „DHCP“ angelegt. Weicht bei einem bestehenden Netz das Gateway vom Scope ab, steht das im Netz mit einem Knopf zum Übernehmen. Abgeglichen wird nur beim Öffnen, geändert wird nie von selbst und nie etwas in Technitium.

**Typ und Erreichbarkeit:** Jede belegte Adresse zeigt ihren Typ: _Reservierung_ (DHCP-Reservierung), _Lease_ (dynamisch vergebene DHCP-Adresse) oder _Statisch_ (nur im DNS eingetragen, von Hand bestätigt oder per Ping entdeckt). Daneben steht, ob sie auf Ping antwortet (Online, Offline, nicht geprüft). Dieselbe Anzeige gibt es bei den A-Einträgen im DNS.

**Seitenfenster:** Ein Klick auf einen Block im Raster oder auf eine Adresse in der Liste öffnet ein Seitenfenster (auf dem Handy als Vollbild, Link über `?ip=`) mit Überblick, DHCP (Bereich, Reservierung, Lease), DNS (A-Einträge, PTR) und Erreichbarkeit. Lesen dürfen alle Benutzer. Admins können dort direkt handeln: eine Lease in eine Reservierung umwandeln (dabei Hostname, Kommentar und auf Wunsch den A-Eintrag samt PTR festlegen; schlägt ein Schritt fehl, wird zurückgenommen) oder freigeben, Reservierungen bearbeiten, löschen oder in eine Lease zurückwandeln, DNS-Einträge der Adresse anlegen, ändern und löschen sowie entdeckte Geräte bestätigen oder vergessen. Alles steht im Änderungsprotokoll. Änderungen in Technitium sind sofort sichtbar, die Belegung wird danach neu geladen.

**Suchen und Filtern:** Die IP-Liste durchsucht Adresse, Name, MAC, Hersteller, Scope, Quelle, Typ, Status und Kategorie; mehrere Suchbegriffe müssen alle zutreffen. Dazu kommen Filter-Chips mit Zähler (Typ, Status, Merkmal, Kategorie), Sortierung per Klick auf die Spaltenüberschrift und wählbare Spalten. Suche, Filter und Sortierung stehen in der URL (Link teilen, Zurück-Taste), die gewählten Spalten merkt sich der Browser. Auch die Listen auf der DHCP-Seite suchen nach Hersteller. Die DNS-Records einer Zone haben dieselbe Leiste (Suche, Typ- und Status-Chips, sortierbare Spalten).

**Konsistenzhinweise:** Die IP-Liste und das Seitenfenster zeigen, wenn DHCP und DNS auseinanderlaufen: **DNS fehlt** (benannte Reservierung ohne A-Eintrag), **Name weicht ab** (DHCP-Name und DNS-Name unterscheiden sich im ersten Namensteil; Groß-/Kleinschreibung und Zone zählen nicht) und **PTR fehlt** (A-Eintrag und Reverse-Zone vorhanden, aber kein PTR; nur im Seitenfenster, weil die Liste keine Reverse-Zonen lädt). Dynamische Leases werden nicht geprüft, weil ihre Namen zu oft wechseln. In der Liste lässt sich nach den Hinweisen filtern. Admins beheben sie im Seitenfenster per Klick: A-Eintrag anlegen (Formular mit dem DHCP-Namen vorbelegt), A-Eintrag umbenennen (der PTR wird mit angepasst) oder PTR anlegen. Es gibt keinen stillen Abgleich im Hintergrund, jede Änderung geschieht erst nach Klick und steht im Änderungsprotokoll.

**Netzwerk und Protokoll:** Die drei Seiten IPAM, DNS und DHCP bilden zusammen den Bereich „Netzwerk“ mit den Reitern **IPs** (`/ipam`), **Zonen** (`/dns`), **Scopes** (`/dhcp`) und **Protokoll** (`/protokoll`, nur für Admins). Das Protokoll zeigt alle Änderungen an Technitium und IPAM (die letzten 1000) mit lesbaren Aktionsnamen. Gefiltert wird nach Zeitraum (24 Stunden, 7 oder 30 Tage), Ergebnis, Bereich (DNS, DHCP, IPAM, Verbindung) und Benutzer, dazu Freitextsuche und Sortierung. Auch hier lassen sich Ansichten speichern.

**Gespeicherte Ansichten:** Über „Ansichten“ in der Filterleiste lassen sich Suche, Filter, Sortierung und (in der IP-Liste) die sichtbaren Spalten unter einem Namen speichern und später mit einem Klick wieder anwenden. Gleicher Name überschreibt. Die Ansichten gehören dem einzelnen Benutzer, auch ohne Admin-Rechte; IP-Liste und DNS-Records haben getrennte Listen.

**Hersteller aus der MAC:** Zu jeder MAC zeigt die Oberfläche den Hersteller aus der öffentlichen IEEE-OUI-Liste (rund 40.000 Einträge, im Server mitgeliefert, kein Abruf zur Laufzeit). Zufällige („private“) MAC-Adressen moderner Handys haben keinen Hersteller und heißen „Zufällige MAC“. Neuere, kleinere Blöcke (MA-M/MA-S) fehlen in der Liste; solche Geräte erscheinen als „Unbekannter Hersteller“. Die Liste aktualisieren: `npm pack oui-data`, entpacken und `node apps/server/scripts/build-oui.mjs <Pfad>/package/index.json` ausführen.

**Neue IP anlegen (Admins):** „Neue IP“ in der Netzansicht oder „Neue IP anlegen“ im Seitenfenster einer freien Adresse öffnet den Assistenten. Er legt pro Vorgang genau eine Adresse an, entweder als DHCP-Reservierung (Scope, MAC, Hostname, Kommentar) oder statisch (nur DNS). Der DNS-Eintrag ist standardmäßig an, Zone, TTL und PTR sind änderbar. Eine statische Adresse im DHCP-Pool wird nur mit Warnung angelegt, eine schon belegte (Lease, DNS oder Ping-Antwort) erst nach Bestätigung. Eine Zusammenfassung zeigt vorher alle Schritte; schlägt der DNS-Schritt fehl, wird die Reservierung zurückgenommen. Alles steht im Änderungsprotokoll.

**Ping-Prüfung:** Ultimate Dash pingt alle 30 Minuten (einstellbar von 5 Minuten bis 1 Tag) jede Adresse der Netze, bei denen „Per Ping prüfen“ aktiv ist (Netze bis /22, höchstens 32 Pings gleichzeitig). „Jetzt scannen“ in der Kopfzeile startet einen Durchlauf sofort. Antwortet eine Adresse, die weder in DHCP noch im DNS steht, wird sie als **entdeckt** aufgenommen, in Liste und Raster hervorgehoben und bleibt dort, solange sie antwortet. Admins können sie bestätigen (mit Name, dann gilt sie als bekannt und bleibt auch offline belegt) oder vergessen. Geräte, die Ping blockieren, erscheinen als offline beziehungsweise bleiben unentdeckt. Der Ping kommt vom Server aus, das Netz muss also von dort erreichbar sein (Routing/VLAN, im Docker-Image ist `ping` enthalten).

Ohne Verbindung zu Technitium lassen sich Netze und Bereiche trotzdem pflegen, nur die Belegung fehlt. Änderungen sind Admins vorbehalten und stehen im Änderungsprotokoll.

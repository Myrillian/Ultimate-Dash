# Vereinheitlichte IP-Verwaltung (Konzept)

> Stand: 06.11.2026. Entwurf, abgestimmt mit Matthias im Projekt-Thread. Gebaut wird erst nach Freigabe dieser Seite.

## Ziel

Heute gibt es drei getrennte Bereiche (DNS, DHCP, IPAM), jeder mit eigenen Listen und Aktionen. Gewünscht ist **eine** Ansicht, in der man zu jeder IP-Adresse sieht und direkt bearbeitet:

- ob sie frei ist, ein Lease, eine Reservierung oder statisch,
- welche DNS-Einträge dazu gehören (A, PTR, CNAMEs darauf),
- ob sie erreichbar ist und welcher Kategorie sie angehört.

Dazu kommen ausgereifte Such- und Filtermöglichkeiten in allen Listen.

Entscheidung (06.11.2026): Die IP-Ansicht wird die Hauptseite. DNS-Zonen und DHCP-Scopes bleiben als Unterseiten für Einstellungen auf Zonen- und Scope-Ebene.

## Begriff: der IP-Eintrag

Ein IP-Eintrag ist keine neue Tabelle, sondern eine **berechnete Sicht** je Adresse. Er führt zusammen, was Technitium und das IPAM wissen:

| Teil | Quelle |
| --- | --- |
| Typ: frei, Lease, Reservierung, statisch | DHCP-Leases, DHCP-Reservierungen, sonst DNS, Ping oder manuell bestätigt |
| DHCP: Scope, MAC, Hostname, Ablauf, Kommentar | Technitium |
| DNS: alle Einträge, die auf die IP zeigen (A) oder zu ihr gehören (PTR), samt CNAMEs auf diese Namen | Technitium (Forward- und Reverse-Zonen) |
| Erreichbarkeit: online, offline, zuletzt gesehen | Ping-Prüfung |
| Netz, VLAN, Kategorie, Bereich | IPAM-Datenbank |
| Hinweise: Konflikt, entdeckt, DNS fehlt, PTR fehlt | berechnet |

Das IPAM speichert weiterhin nur das, was nirgends sonst existiert (Netze, Kategorien, Bereiche, bestätigte statische Geräte). Technitium bleibt die Quelle für DHCP und DNS.

## Bedienung

**Einstieg:** Raster und Liste zeigen jede IP. Ein Klick auf einen Block im Raster oder auf eine Zeile in der Liste öffnet ein **Seitenfenster** mit dem IP-Eintrag. Das Seitenfenster hat Abschnitte Überblick, DHCP, DNS und Erreichbarkeit, jeweils mit „Bearbeiten“. Auf dem Handy öffnet es sich als Vollbild.

### Was ein Klick auslöst

| Zustand der IP | Seitenfenster zeigt | Aktionen |
| --- | --- | --- |
| **Frei** (außerhalb des DHCP-Pools) | „Frei“ | Assistent „Neue IP“ (Reservierung oder statisch, optional DNS) |
| **Frei im DHCP-Pool** | „Frei, wird dynamisch vergeben“ | Assistent „Neue IP“ mit Reservierung vorausgewählt; statisch nur mit Warnung |
| **Lease** | MAC, Hostname, Scope, Vergabe und Ablauf, DNS-Einträge, Erreichbarkeit | In Reservierung umwandeln (vorher Name, Kommentar und DNS bearbeitbar), Lease freigeben, DNS bearbeiten |
| **Reservierung** | MAC, IP, Hostname, Kommentar, DNS-Einträge | Bearbeiten (MAC, IP, Name, Kommentar, DNS), löschen, in dynamisch zurückwandeln |
| **Statisch** | Name und Notiz (IPAM), DNS-Einträge | Name und Notiz bearbeiten, DNS anlegen, ändern, löschen, Eintrag vergessen |
| **Entdeckt** | Per Ping gefunden, sonst unbekannt | Bestätigen (mit Name), DNS anlegen, in Reservierung umwandeln, vergessen |
| **Konflikt** | Beteiligte Geräte (MAC) | Den falschen Eintrag löschen oder ändern |

**Grenze von Technitium:** Eine laufende Lease lässt sich nicht ändern, nur freigeben oder in eine Reservierung umwandeln. „Lease bearbeiten“ bedeutet deshalb: in eine Reservierung umwandeln und dabei Name, Kommentar und DNS setzen. Das Seitenfenster sagt das offen dazu. Eine Reservierung ändern wir wie bisher per „entfernen und neu anlegen“, mit Rückgängig bei Fehlern.

### Assistent „Neue IP“

Aufruf: Klick auf einen freien Block, oder Schaltfläche „Neue IP“ in der Kopfzeile (dann mit Wahl von Netz und Kategorie). Der Assistent legt **immer genau eine IP** pro Vorgang an.

1. **Wo:** Netz und Kategorie (falls nicht durch den Klick bekannt). Die angeklickte IP ist vorgeschlagen, sonst die erste freie IP des Bereichs; alternativ Auswahl aus einer Liste freier IPs oder eigene Eingabe.
2. **Art:** Reservierung (braucht MAC und Scope) oder statisch (nur DNS und Notiz). Liegt eine statische IP im DHCP-Pool, steht dort eine Warnung, dass der Server sie vergeben könnte. Verboten ist es nicht.
3. **Prüfung:** Ist die IP schon belegt (Lease, DNS, Ping antwortet), wird das angezeigt und muss bestätigt werden.
4. **DNS:** Name, Zone, TTL und PTR. Standardmäßig an, jeder Wert änderbar.
5. **Zusammenfassung:** Alle Änderungen als Liste. Beim Bestätigen werden sie der Reihe nach ausgeführt; schlägt ein Schritt fehl, werden die bisherigen zurückgenommen. Alles landet im Änderungsprotokoll.

### DNS mitführen

Beim Anlegen oder Umwandeln ist der DNS-Eintrag standardmäßig an und bleibt trotzdem änderbar (anderer Name, andere Zone, aus). Ändert man später den Hostnamen einer Reservierung, schlägt das Seitenfenster vor, den A-Eintrag mit umzubenennen, und führt es nach Bestätigung für A und PTR gemeinsam aus. Es gibt keinen stillen Hintergrundabgleich: Abweichungen zwischen DHCP-Namen und DNS werden als Hinweis am IP-Eintrag angezeigt und per Klick behoben.

## Suchen und Filtern (alle Listen)

Ein gemeinsamer Baukasten für IP-Liste, DNS-Einträge, DHCP-Leases und Reservierungen, Protokoll:

- **Freitextsuche** über alle sinnvollen Spalten gleichzeitig (Adresse, Namen, MAC, Kommentar).
- **Filter als Chips**, kombinierbar (UND); Mehrfachauswahl innerhalb eines Filters (ODER).
- **Sortierung** nach jeder Spalte, IP-Adressen numerisch.
- **Spalten** ein- und ausblendbar, Auswahl wird gemerkt.
- **Filter stehen in der URL**, damit Links und „zurück“ funktionieren. Häufige Filter lassen sich als **gespeicherte Ansicht** merken. Gespeicherte Ansichten (und gemerkte Spalten und Sortierung) gehören dem einzelnen Benutzer, die Daten dahinter sind für alle gleich.
- Zähler „n von m“ und ein Knopf „Filter zurücksetzen“.

Sinnvolle Attribute je Liste:

| Liste | Suche und Filter |
| --- | --- |
| **IPs** | Adresse oder Teilbereich (z. B. `10.10.10.100-150`), Name, DNS-Name, MAC (auch Teil), Netz, VLAN, Kategorie, Bereich, Typ (frei, Lease, Reservierung, statisch), Erreichbarkeit (online, offline, nicht geprüft), entdeckt, Konflikt, Scope, Lease läuft ab in (z. B. unter 1 Tag), zuletzt gesehen vor mehr als N Tagen, hat DNS-Eintrag (ja/nein), hat PTR (ja/nein), Kommentar |
| **DNS-Einträge** | Name, Typ, Wert, Zone, TTL, deaktiviert, Kommentar, zeigt auf IP in Netz X, Ziel erreichbar (Ping) |
| **Leases** | IP, Hostname, MAC, Scope, Typ (dynamisch, reserviert), Ablauf, vergeben seit, Netz |
| **Reservierungen** | IP, Hostname, MAC, Scope, Kommentar, hat DNS-Eintrag |
| **Protokoll** | Zeitraum, Benutzer, Aktion, Ziel, Ergebnis (erfolgreich oder fehlgeschlagen) |

**Hersteller aus der MAC:** Zu jeder MAC zeigt die Oberfläche den Hersteller (z. B. „Synology“, „Apple“), in IP-Liste, Seitenfenster, Leases und Reservierungen, und man kann danach suchen und filtern. Grundlage ist die öffentliche IEEE-OUI-Liste, die als Datei im Server mitgeliefert wird (kein Abruf zur Laufzeit). Zufällige, „private“ MAC-Adressen (moderne Handys) haben keinen Hersteller und werden als „Zufällige MAC“ gekennzeichnet.

## Navigation

Oben ein gemeinsamer Bereich „Netzwerk“ mit den Reitern:

1. **IPs** (Hauptseite, heute IPAM): Raster, Liste, Seitenfenster, Assistent
2. **Zonen** (heute DNS): Zonen und alle Einträge, für Arbeit auf Zonenebene
3. **Scopes** (heute DHCP): Scopes, Bereiche, Ausschlüsse
4. **Protokoll:** Änderungsprotokoll (bisher nur per API)

DNS und DHCP bleiben erreichbar und behalten ihre Listen. Wer an einem Eintrag klickt, landet im selben Seitenfenster wie in der IP-Ansicht. So gibt es überall dieselbe Bearbeitung.

## Dashboard pro Benutzer

Das Dashboard (Gruppen, Dienste, Reihenfolge, eingeklappte Gruppen) gehört künftig dem einzelnen Benutzer. IPAM, DHCP und DNS bleiben für alle gleich.

- **Datenmodell:** Gruppen bekommen einen Besitzer (`user_id`), Dienste hängen wie bisher an Gruppen. Beim Löschen eines Benutzers fällt sein Dashboard mit weg.
- **Bestehende Daten:** Das heutige Dashboard geht bei der Migration an den ersten Admin-Account. Alle anderen Benutzer starten leer.
- **Bearbeiten:** Jeder Benutzer, auch ohne Admin-Rolle, bearbeitet sein eigenes Dashboard, weil jeder andere Dienste pflegen möchte. Die Leserechte-Regel gilt für IPAM, DHCP und DNS, nicht für die persönliche Ansicht.
- **Statusprüfung:** Der Server prüft jeden Dienst nur einmal, auch wenn mehrere Benutzer dieselbe Adresse haben; jeder sieht den Status seiner Dienste.
- **Export und Import:** beziehen sich auf das eigene Dashboard.
- **Kopieren von …:** Neue Benutzer starten leer, können aber Einträge aus dem Dashboard eines anderen Benutzers übernehmen. Der Dialog zeigt dessen Gruppen und Dienste als Baum mit **Kontrollkästchen je Gruppe und je Dienst**; ausgewählt wird, was kopiert werden soll. Kopiert wird eine unabhängige Kopie, spätere Änderungen wirken sich nicht auf das Original aus. Bereits vorhandene Gruppen mit gleichem Namen werden ergänzt statt doppelt angelegt.


- **Backend:** Neuer Endpunkt `GET /api/ipam/ips/:adresse` (und Liste mit Filtern) liefert den IP-Eintrag. Er nutzt die vorhandenen Dienste (DHCP, DNS-Records, Ping-Daten). Dazu ein Reverse-Index der DNS-Einträge (A auf IP, PTR, CNAMEs auf Namen), der wie die Belegung 15 Sekunden gecacht wird.
- **Aktionen:** Ein Dienst „IP-Aktionen“ bündelt die Mehrschritt-Abläufe (Reservierung plus DNS plus PTR, Umwandeln, Umbenennen) mit Rücknahme bei Fehlern und einem Audit-Eintrag je Ablauf. Die Validierung liegt in `packages/shared`.
- **Frontend:** Ein Seitenfenster-Baustein und ein Filter-Baustein, die in allen Listen gleich verwendet werden.
- **Rechte:** IPAM, DHCP und DNS sind für alle Benutzer gleich und dieselben Daten. Ohne Admin-Rolle gibt es nur Leserechte: Das Seitenfenster zeigt alles, aber ohne Bearbeiten, Assistent, Scan-Knopf und Bestätigen. Das wird im Server erzwungen (wie bisher für alle schreibenden Aufrufe) und in der Oberfläche ausgeblendet. Technitium-Zugangsdaten bleiben nur für Admins sichtbar.
- **Nicht im Umfang:** Scopes oder Zonen anlegen und löschen, IPv6, Hintergrund-Synchronisation, mehrere IPs auf einmal anlegen.

## Umsetzung in Schritten

0. **Dashboard pro Benutzer:** Migration, Besitzer je Gruppe, Statusprüfung ohne Doppelarbeit. Unabhängig vom Rest und deshalb zuerst oder parallel möglich.
1. **IP-Eintrag und Seitenfenster (nur Lesen):** Zusammenführung, Klick im Raster und in der Liste, Anzeige aller Teile.
2. **Aktionen im Seitenfenster:** Lease in Reservierung umwandeln und freigeben, Reservierung bearbeiten und löschen, DNS bearbeiten, statische Einträge pflegen, Entdeckte bestätigen.
3. **Assistent „Neue IP“** und Klick auf freie Blöcke.
4. **Such- und Filterbaukasten** in IP-Liste, DNS, Leases, Reservierungen.
5. **Navigation** zusammenführen, Protokollansicht.
6. **Hinweise zur Konsistenz** (DNS fehlt, PTR fehlt, Name weicht ab) mit Behebung per Klick.

Jeder Schritt ist ein eigener Pull Request und nach dem Merge benutzbar.

## Entschieden am 06.11.2026

- Hersteller aus der MAC wird angezeigt (mitgelieferte OUI-Liste).
- Der Assistent legt nur eine IP pro Vorgang an.
- Jeder Benutzer bearbeitet sein eigenes Dashboard (auch ohne Admin-Rolle); neue Benutzer starten leer und können mit Kontrollkästchen je Eintrag von anderen kopieren.
- Dashboard und Ansichten sind pro Benutzer, die IPAM-, DHCP- und DNS-Daten für alle gleich. Ohne Admin-Rolle nur Leserechte.

## Offene Punkte

- Keine. Das Konzept ist zur Freigabe bereit.

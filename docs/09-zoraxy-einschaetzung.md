# Zoraxy-Integration: Einschätzung

Stand: 12.11.2026. Ergebnis einer ersten Recherche, noch keine Umsetzung.

## Kurzfassung

Eine lesende Anbindung ist sehr wahrscheinlich machbar, denn Zoraxy hat eine eigene Verwaltungs-Oberfläche, die über JSON-Endpunkte unter `/api/…` arbeitet. **Offen ist die Anmeldung**: Die README nennt weder eine dokumentierte API noch API-Tokens. Bevor Code entsteht, muss an einer echten Zoraxy-Instanz geklärt werden, ob es einen API-Schlüssel (Bearer-Token) gibt oder nur die Sitzung mit Benutzername und Passwort. Diese Punkte konnte ich ohne Zugriff auf eine Instanz nicht bestätigen; die genannten Pfade stammen aus dem Gedächtnis und sind unverifiziert.

Belegt (README des Projekts): Reverse-Proxy mit HTTP/2, Lastverteilung und WebSocket, Weiterleitungsregeln, TLS mit ACME, IP- und Länder-Sperrlisten, Stream-Proxy (TCP/UDP), integrierter Uptime-Monitor, Plugin-System, Forward-Auth/OAuth2.

## Sinnvolle Funktionen (nach Nutzen)

1. **Proxy-Regeln als Dienste anzeigen und importieren.** Jede Regel (Domain → Ziel) ist ein Dashboard-Eintrag. Ein Import-Vorschlag „Dienste aus Zoraxy übernehmen“ spart Handarbeit und hält Dashboard und Proxy deckungsgleich. Nur Vorschlagsliste, nie automatisch überschreiben (wie beim IPAM-Abgleich, Entscheidung 11).
2. **Statusabgleich.** Zoraxy führt einen Uptime-Monitor. Das Dashboard kann dessen Ergebnis neben der eigenen Statusprüfung zeigen (z. B. „Proxy erreichbar, Ziel nicht“).
3. **Zertifikate.** Ablaufdatum der TLS-Zertifikate je Domain; Warnung unter 14 Tagen.
4. **Kennzahlen.** Anfragen, Fehlerquote, gesperrte Zugriffe als kleine Leiste neben DNS und Proxmox.
5. **Domains mit Technitium abgleichen** (IPAM): Zoraxy-Domain ohne DNS-Eintrag oder DNS-Eintrag ohne Proxy-Regel.

Nicht empfohlen: Regeln aus dem Dashboard heraus ändern. Ein Fehler dort legt alle Dienste lahm; das passt nicht zum bisherigen Prinzip „erst lesen, Schreiben nur gezielt“ (Proxmox, Entscheidung 19).

## Umsetzungsskizze

- Einstellung `zoraxy` (URL, Zugang, „Zertifikat nicht prüfen“) oder `ZORAXY_*`-Variablen, nur Admins, Aufrufe nur über das Backend, feste Pfadliste mit `GET`, kurzer Zwischenspeicher – wie bei Proxmox.
- Verbindungstest zeigt, welche Rechte der Zugang hat.

## Zu klären, bevor es losgeht

1. Gibt es in der eingesetzten Zoraxy-Version API-Schlüssel? Falls nein: Anmeldung per Sitzungscookie nachbauen (Passwort im Dashboard speichern) oder Plugin?
2. Welche Version läuft, und gibt es mehrere Zoraxy-Instanzen?
3. Reichen Import und Status, oder soll auch Zertifikats- und Kennzahlen-Anzeige rein?

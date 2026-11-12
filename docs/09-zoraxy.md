# Zoraxy

Das Dashboard zeigt die Proxy-Hosts von Zoraxy mit Erreichbarkeit und Ablauf der Zertifikate. Der Zugriff ist rein lesend und nur für Admins sichtbar. Entscheidung und Gründe: `docs/04-entscheidungen.md`, Nr. 24. Planung und Recherche: Projektordner `zoraxy/plan-zoraxy.md`. Die erste Einschätzung steht in [09-zoraxy-einschaetzung.md](09-zoraxy-einschaetzung.md).

## Anzeige

Unter dem Proxmox-Bereich, über den Gruppen, in zwei Größen (Umschalter rechts, Wahl pro Browser):

- **Balken (Standard):** Anzahl aktiver Hosts, „erreichbar x / y“, Tage bis zum nächsten Ablauf eines Zertifikats (gelb ab 14, rot ab 3 Tagen), Anfragen des Tages mit Fehlern und ein Hinweis „n Probleme“.
- **Liste:** vier Kacheln (Hosts, Erreichbar, Zertifikate, Anfragen heute) und darunter die Proxy-Hosts mit Statuspunkt, erstem Ziel und Restlaufzeit des Zertifikats. Hosts mit Problemen (nicht erreichbar, Zertifikat läuft in höchstens 14 Tagen ab) stehen oben.

Ist Zoraxy nicht verbunden, sehen Admins den Hinweis „Zoraxy verbinden“. Bei einem Fehler bleibt der letzte Stand sichtbar und abgeblendet.

## Einrichten

Einstellungen › „Verbindungen › Zoraxy“: Adresse der Verwaltungsoberfläche (z. B. `http://zoraxy.home.lan:8000`), Benutzername, Passwort, optional „Zertifikat nicht prüfen“. „Verbindung prüfen“ zeigt Version, Anzahl Hosts und Zertifikate; gespeichert wird nur eine funktionierende Verbindung.

Alternativ per Umgebungsvariablen `ZORAXY_URL`, `ZORAXY_USERNAME`, `ZORAXY_PASSWORD`, `ZORAXY_TLS_INSECURE=true`. Dann ist die Verbindung in der Oberfläche nur lesbar.

## Zugang und Sicherheit

Zoraxy hat keine API-Tokens und nur ein einziges Konto mit Vollzugriff. Der Server meldet sich deshalb mit diesem Konto an (`POST /api/auth/login`), holt zuerst das CSRF-Token von `/login.html` (Zoraxy schützt auch die Anmeldung per gorilla/csrf: Cookie `_gorilla_csrf` plus Kopfzeile `X-CSRF-Token`, Token als `<meta name="zoraxy.csrf.Token">`), hält Sitzungs-Cookie und Token nur im Speicher und meldet sich bei Ablauf selbst neu an.

Technisch erzwungen ist, dass nichts verändert wird: Der Client kennt nur `GET` auf fünf Pfaden (Anmeldung und die Seiten für das CSRF-Token ausgenommen):

| Pfad | Zweck |
| --- | --- |
| `/api/proxy/list?type=host` | Proxy-Regeln (Pflicht) |
| `/api/cert/list?date=true` | Zertifikate mit Ablaufdatum |
| `/api/utm/list` | Uptime-Monitor |
| `/api/stats/summary` | Anfragen des Tages |
| `/api/info/x` | Version (ohne Anmeldung) |

Fallen Zertifikate, Uptime oder Anfragen aus, bleibt der Rest sichtbar und der Bereich nennt, was fehlt; nur die Hostliste ist Pflicht. Das Passwort steht in der SQLite-Datei (wie die Tokens von Technitium und Proxmox) oder in der Umgebung, geht nie an den Browser und taucht in keiner Antwort auf. Benutzernamen und Hashes der Basic-Auth-Regeln werden nicht weitergegeben. Zwischenspeicher im Server 15 Sekunden, der Browser fragt alle 15 Sekunden, solange der Tab sichtbar ist.

## Berechnung

- **Erreichbar:** letzter Wert des Uptime-Monitors von Zoraxy; zugeordnet über den Hostnamen der überwachten Adresse zu Domain oder Alias der Regel. Ohne Eintrag gilt der Host als „nicht überwacht“.
- **Zertifikat:** Ein Host erhält das genau passende Zertifikat, sonst ein Wildcard-Zertifikat (`*.example.org` deckt genau eine Ebene; Zoraxy-Dateiname `_.example.org`). Bei mehreren Namen (Alias) zählt der kürzeste Wert.
- **Nächster Ablauf:** kürzeste Restlaufzeit aller Zertifikate.

## Stand der Prüfung

Die Zoraxy-API ist nicht als stabile, öffentliche Schnittstelle dokumentiert; Pfade und Felder stammen aus dem Quellcode (Version 3.3.x) und werden bewusst locker gelesen (unbekannte Felder ignoriert, Groß-/Kleinschreibung egal). Tests laufen gegen einen Fake-Server (`pnpm --filter @ultimate-dash/server fake:zoraxy`, Port 8000, Benutzer `admin`), der Anmeldung, Cookie und CSRF nachbildet. Ein Test gegen eine echte Zoraxy-Instanz steht noch aus; Abweichungen zeigt „Verbindung prüfen“.

## Nicht enthalten

Schreibende Aktionen, Zugriffs-Logs, Länderkarte, Stream-Proxy und Weiterleitungen, Verknüpfung mit Diensten und IPAM (siehe Plan, Stufen 4 und 5).

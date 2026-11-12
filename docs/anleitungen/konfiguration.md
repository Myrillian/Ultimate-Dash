# Konfiguration

Fast alles stellst du im Browser ein. Umgebungsvariablen brauchst du nur für Grundeinstellungen, für OIDC und wenn du Verbindungen fest vorgeben willst (etwa bei Infrastructure as Code). Ist eine Verbindung per Umgebungsvariable gesetzt, zeigt die Oberfläche sie nur an und lässt sie nicht ändern.

## Umgebungsvariablen setzen

Mit Docker Compose: `cp .env.example .env`, die gewünschten Zeilen in `.env` einkommentieren und ausfüllen, dann `docker compose up -d`. Compose reicht alle Werte aus `.env` an den Container weiter. `.env` steht in `.gitignore` und landet so nicht versehentlich in Git.

Nach jeder Änderung an `.env` den Container neu erstellen: `docker compose up -d` (ein reines `restart` liest `.env` nicht neu).

## Allgemein

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | HTTP-Port im Container |
| `DATA_DIR` | `/data` (Docker), `./data` | Ordner für Datenbank und Zwischenspeicher |
| `PUBLIC_URL` | – | Öffentliche Adresse, z. B. `https://dash.example.org`. Pflicht für Links in Mails |
| `STATUS_INTERVAL_SECONDS` | `60` | Abstand der Statusprüfungen der Services |
| `STATUS_TIMEOUT_MS` | `5000` | Zeitlimit pro Statusprüfung |
| `FEED_INTERVAL_MINUTES` | `30` | Abstand der Abrufe je RSS-Feed |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_REQUESTS` | `false` | Jede HTTP-Anfrage loggen |

## Einstellungen im Browser

Unter **Einstellungen** (oben rechts):

| Bereich | Wer | Inhalt |
| --- | --- | --- |
| Admin › Benutzer verwalten | Admins | Benutzer anlegen, Rolle und E-Mail ändern, Passwort setzen, Reset-Link erzeugen, löschen |
| Admin › Updates | Admins | Prüft auf neue Versionen und installiert sie bei `install.sh`-Installationen, siehe [Installation](installation.md#updates-aus-der-oberfläche) |
| Verbindungen › Technitium DNS | Admins | Hauptverbindung zu Technitium, siehe [Anleitung](technitium.md) |
| Verbindungen › Proxmox VE | Admins | Verbindung zu Proxmox, siehe [Anleitung](proxmox.md) |
| Verbindungen › Zoraxy | Admins | Verbindung zu Zoraxy, siehe [Zoraxy](../09-zoraxy.md) |
| Verbindungen › Mailserver | Admins | SMTP für „Passwort vergessen“, siehe unten |
| Verbindungen › Feeds verwalten | Admins | RSS-Feeds hinzufügen, abschalten, löschen |
| Backup | alle | eigenes Dashboard als YAML exportieren, importieren oder von anderen Benutzern kopieren |

Weitere DHCP-Server von Technitium richtest du auf der DHCP-Seite über das Zahnrad ein, siehe [Mehrere Technitium-Server](technitium.md#mehrere-technitium-server).

## Benutzer und Rollen

- **Administrator:** darf alles bearbeiten und Benutzer verwalten.
- **Benutzer:** bearbeitet das eigene Dashboard, sieht IPAM, DHCP und DNS, ändert dort aber nichts. Den Proxmox- und den Zoraxy-Bereich sehen nur Admins.

Jeder hat ein eigenes Dashboard. IPAM, DNS und DHCP sind für alle gleich. Passwörter werden mit scrypt gespeichert, Sitzungen laufen 30 Tage und verlängern sich bei Nutzung. Nach zehn Fehlversuchen in 15 Minuten wird die Anmeldung für diesen Benutzernamen und diese IP kurz gesperrt.

## Mailserver

Der Mailserver wird nur für „Passwort vergessen“ gebraucht. Ohne ihn sehen Admins die Anfrage in der Benutzerverwaltung und geben einen Reset-Link selbst weiter.

### In der Oberfläche

Einstellungen › _Verbindungen_ › _Mailserver_:

1. **Server** (IP oder DNS-Name) und **Port** eintragen. Üblich sind 587 mit STARTTLS oder 465 mit SSL/TLS.
2. **Verschlüsselung** wählen: _STARTTLS_ (Verschlüsselung ist Pflicht), _SSL/TLS_ (direkt verschlüsselt) oder _Keine_ (nur im eigenen Netz, z. B. für einen lokalen Relay).
3. **Benutzer** und **Passwort** am Mailserver, falls er eine Anmeldung verlangt.
4. **Absender**, z. B. `Ultimate Dash <dash@example.org>`. Viele Anbieter verlangen, dass der Absender zum Konto passt.
5. **Adresse des Dashboards**, z. B. `https://dash.example.org`. Sie steht in den Links der Mails. Ist `PUBLIC_URL` gesetzt, gilt dieser Wert.
6. Mit **Testmail senden** prüfst du die Werte mit einer echten Mail, ohne zu speichern. **Speichern** klappt nur, wenn Verbindung und Anmeldung funktionieren.

Das Passwort bleibt im Server und wird nicht wieder angezeigt. Damit Benutzer eine Mail bekommen, muss bei ihnen eine E-Mail-Adresse hinterlegt sein (Benutzermenü oder Benutzerverwaltung).

### Per Umgebungsvariablen

Ist `SMTP_HOST` gesetzt, gelten diese Werte und die Oberfläche zeigt sie nur an.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `SMTP_HOST` | – | Mailserver. Ohne diesen Wert ist er in der Oberfläche einstellbar |
| `SMTP_PORT` | `587` | Port |
| `SMTP_ENCRYPTION` | siehe `SMTP_SECURE` | `starttls`, `tls` oder `none` |
| `SMTP_SECURE` | `true` bei Port 465 | Nur ohne `SMTP_ENCRYPTION`: `true` = `tls`, sonst `starttls` |
| `SMTP_USER` | – | Benutzername am Mailserver |
| `SMTP_PASSWORD` | – | Passwort dazu |
| `SMTP_FROM` | – | Absender (Pflicht) |
| `SMTP_TLS_INSECURE` | `false` | Selbst signierte Zertifikate am Mailserver akzeptieren |
| `PUBLIC_URL` | – | Adresse des Dashboards (Pflicht mit `SMTP_HOST`) |

`PUBLIC_URL` muss fest eingestellt sein, weil Links in Mails sonst aus dem `Host`-Header gebaut würden, den ein Angreifer fälschen kann.

### Ablauf „Passwort vergessen“

- **Mit Mailserver** und hinterlegter Adresse bekommt der Benutzer einen Link, der eine Stunde gilt und nur einmal funktioniert.
- **Ohne Mailserver** oder ohne Adresse erscheint die Anfrage in der Benutzerverwaltung. Admins erzeugen dort einen Reset-Link (24 Stunden gültig) oder setzen direkt ein neues Passwort.

Die Seite antwortet immer gleich, damit sich keine Benutzernamen ausforschen lassen. Nach dem Zurücksetzen ist der Benutzer auf allen anderen Geräten abgemeldet.

## Anmeldung über OIDC (Authentik, Keycloak, Authelia, Pocket ID …)

Mit OIDC erscheint auf der Anmeldeseite zusätzlich ein Knopf für deinen SSO-Anbieter. Das lokale Admin-Konto aus der Ersteinrichtung bleibt als Notzugang bestehen.

1. Beim Anbieter eine OIDC-Anwendung („confidential client“) anlegen. Redirect-URI: `https://<deine-dashboard-adresse>/api/auth/oidc/callback`
2. Variablen in `.env` setzen und `docker compose up -d` ausführen.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OIDC_ISSUER` | – | Issuer-URL, z. B. `https://auth.example.org/application/o/ultimate-dash/` (Authentik) |
| `OIDC_CLIENT_ID` | – | Client-ID |
| `OIDC_CLIENT_SECRET` | – | Client-Secret (leer bei öffentlichen Clients) |
| `OIDC_REDIRECT_URI` | aus der Anfrage | Feste Callback-Adresse, falls der Reverse-Proxy `Host`/`X-Forwarded-Proto` nicht korrekt weitergibt |
| `OIDC_SCOPES` | `openid profile email` | Für Gruppen ggf. `groups` ergänzen (Authelia, Keycloak mit Mapper) |
| `OIDC_BUTTON_LABEL` | `Mit SSO anmelden` | Beschriftung des Knopfs |
| `OIDC_GROUPS_CLAIM` | `groups` | Claim mit den Gruppen |
| `OIDC_ADMIN_GROUPS` | – | Kommagetrennt. Mitglieder werden Admin, alle anderen „Benutzer“. Wird bei jeder Anmeldung abgeglichen |
| `OIDC_ALLOWED_GROUPS` | – | Kommagetrennt. Nur Mitglieder dürfen sich anmelden |
| `OIDC_AUTO_CREATE` | `true` | Unbekannte Konten beim ersten Login anlegen. Bei `false` nur bereits verknüpfte Konten |
| `OIDC_LINK_BY_USERNAME` | `false` | Erste SSO-Anmeldung mit einem gleichnamigen lokalen Benutzer verbinden (nur, wenn Benutzernamen beim Anbieter nicht frei wählbar sind) |
| `OIDC_TLS_INSECURE` | `false` | Selbst signierte Zertifikate des Anbieters akzeptieren |

Konten werden über den `sub`-Claim zugeordnet, eine Umbenennung beim Anbieter ist also unproblematisch. Ohne `OIDC_ADMIN_GROUPS` werden neue SSO-Benutzer als „Benutzer“ angelegt, und ein Admin vergibt die Rolle. Der letzte Admin wird durch fehlende Gruppen nie herabgestuft. Abmelden beendet nur die Sitzung im Dashboard, nicht die beim Anbieter.

## Technitium und Proxmox fest vorgeben

| Variable | Bedeutung |
| --- | --- |
| `TECHNITIUM_URL`, `TECHNITIUM_TOKEN` | Hauptverbindung zu Technitium |
| `TECHNITIUM_TLS_INSECURE` | `true` = Zertifikat nicht prüfen |
| `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET` | Verbindung zu Proxmox |
| `PROXMOX_TLS_INSECURE` | `true` = Zertifikat nicht prüfen |
| `ZORAXY_URL`, `ZORAXY_USERNAME`, `ZORAXY_PASSWORD` | Verbindung zu Zoraxy (Admin-Konto) |
| `ZORAXY_TLS_INSECURE` | `true` = Zertifikat nicht prüfen |

Details in den Anleitungen zu [Technitium](technitium.md) und [Proxmox](proxmox.md).

## Update-Prüfung

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `UPDATE_CHECK` | `true` | `false` schaltet die Abfrage der GitHub-Veröffentlichungen unter Einstellungen › Updates ab |
| `UPDATE_REPO` | `myrillian/ultimate-dash` | Repository (`Besitzer/Name`), dessen Veröffentlichungen geprüft werden |

Die Prüfung fragt höchstens einmal pro Stunde. Installieren aus der Oberfläche geht nur bei `install.sh`-Installationen, siehe [Updates aus der Oberfläche](installation.md#updates-aus-der-oberfläche).

## Nur für die Entwicklung

`HOST`, `DATABASE_FILE`, `MIGRATIONS_DIR` und `WEB_ROOT` sind im Docker-Image passend gesetzt und sollten dort nicht geändert werden. `SCRYPT_N` ist nur für Tests gedacht. `UD_UPDATE_REQUEST_FILE` und `UD_UPDATE_STATUS_FILE` setzt `install.sh` im systemd-Dienst selbst (Ablageorte für das Update aus der Oberfläche); sie müssen nicht gesetzt werden.

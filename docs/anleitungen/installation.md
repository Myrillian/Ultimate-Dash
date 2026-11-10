# Installation mit Docker

Diese Anleitung bringt Ultimate Dash auf einem Linux-Host mit Docker zum Laufen. Danach geht es mit der [Konfiguration](konfiguration.md) weiter.

## Voraussetzungen

- Linux-Host im eigenen Netz (VM, LXC mit Docker, Mini-PC, NAS mit Docker)
- Docker Engine mit dem Compose-Plugin ab Version 2.24 (`docker compose version`)
- Git
- Rund 1 GB freier Platz für das Bauen des Images

Meldet `docker compose` „unknown shorthand flag: 'd'“, fehlt das Compose-Plugin (häufig bei Docker aus dem Ubuntu-Paket `docker.io`). Unter Ubuntu hilft `apt install docker-compose-v2`, sonst die [offizielle Anleitung](https://docs.docker.com/compose/install/linux/).

Soll Ultimate Dash Adressen per Ping prüfen (IPAM), muss der Host die Netze erreichen können (Routing, VLANs, Firewall).

## 1. Herunterladen und starten

```bash
git clone https://github.com/Myrillian/ultimate-dash.git
cd ultimate-dash
cp .env.example .env      # optional, nur wenn du Werte fest vorgeben willst
docker compose up -d --build
```

Das erste Bauen dauert einige Minuten. Danach läuft das Dashboard auf `http://<IP des Hosts>:3000`.

Prüfen, ob alles läuft:

```bash
docker compose ps         # Status „healthy“
docker compose logs -f    # Log-Ausgabe, Ende mit Strg+C
```

## 2. Administrator anlegen

Beim ersten Aufruf im Browser fragt Ultimate Dash nach einem Benutzernamen und Passwort für das erste Administrator-Konto. Danach ist das Dashboard nur nach der Anmeldung erreichbar.

> Bis das Konto angelegt ist, kann jeder im Netz es anlegen. Richte es daher direkt nach dem Start ein.

## 3. Verbindungen einrichten

Alles Weitere geht im Browser unter **Einstellungen** (Zahnrad oben rechts) › _Verbindungen_:

- [Technitium DNS](technitium.md) für DNS-Statistik, Zonen, DHCP und IPAM
- [Proxmox VE](proxmox.md) für die Host-Auslastung
- [Mailserver](konfiguration.md#mailserver) für „Passwort vergessen“ per E-Mail
- _Feeds verwalten_ für die Neuigkeiten-Leiste

## Daten und Rechte

Alle Daten liegen in `./data` neben der `docker-compose.yml`: die SQLite-Datenbank `ultimate-dash.db` (mit Zugangsdaten zu Technitium, Proxmox und Mailserver) und ein Zwischenspeicher für die Icon-Listen. Der Container setzt beim Start den Besitzer des Ordners auf UID 1000 und läuft danach ohne root-Rechte.

Andere Port gefällig? In `docker-compose.yml` die linke Zahl ändern, z. B. `'8080:3000'`.

## Update

```bash
cd ultimate-dash
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch. Lege vor einem Update ein Backup an.

## Backup und Wiederherstellung

Am sichersten bei gestopptem Container:

```bash
docker compose stop
tar czf ultimate-dash-backup-$(date +%F).tgz data .env
docker compose start
```

Zum Wiederherstellen den Container stoppen, den Ordner `data` (und `.env`) aus dem Archiv zurückspielen und wieder starten. Das Backup enthält Zugangsdaten. Bewahre es entsprechend geschützt auf.

Zusätzlich lässt sich jedes Dashboard unter Einstellungen › _Backup_ als YAML exportieren. Das enthält nur Gruppen und Services, keine Benutzer, IPAM-Daten oder Zugangsdaten.

## Alternative: Installationsskript ohne Docker (Ubuntu/Debian)

Auf einem leeren Ubuntu- oder Debian-Host übernimmt `install.sh` die komplette Einrichtung: Systempakete, Node.js 22, pnpm, Systembenutzer, Bauen, systemd-Dienst, Backups. Es braucht root-Rechte und systemd.

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/myrillian/ultimate-dash.git
cd ultimate-dash
sudo ./install.sh
```

Das Menü bietet genau diese Punkte:

| Nr. | Punkt                 | Was passiert                                                                                                                                                                                      |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | install dependencies  | Installiert `git`, Build-Werkzeuge (für `better-sqlite3`), `iputils-ping`, `sqlite3`, Node.js 22 (NodeSource) und pnpm (corepack). Mehrfaches Ausführen schadet nicht.                              |
| 2   | install ultimate dash | Führt Punkt 1 aus, legt den Benutzer `ultimate-dash` und die Ordner an, fragt Port und `PUBLIC_URL`, klont das Repository, baut es, richtet den Dienst `ultimate-dash.service` ein und startet ihn. |
| 3   | repair system         | Prüft Pakete, Node.js, pnpm, Benutzer, Ordner und Rechte, Konfiguration, Node-Module, Build, Datenbank (`integrity_check`) und Dienst. Fehlendes wird nachinstalliert, Dienst bei Bedarf neu gestartet. |
| 4   | update dependencies   | Aktualisiert Systempakete, Node.js (innerhalb von 22.x) und pnpm und installiert die Node-Module laut `pnpm-lock.yaml` neu, auch native Module.                                                    |
| 5   | update ultimate dash  | Legt zuerst ein Backup an, holt den neuesten Stand, baut neu und startet den Dienst. Schlägt das Bauen fehl, wird der alte Stand wiederhergestellt. Migrationen laufen beim Start.               |
| 6   | create local backup   | Sichert Datenbank (konsistent per SQLite-Backup, auch bei laufendem Dienst), Datenordner und `ultimate-dash.env` als `.tar.gz`.                                                                   |
| 7   | restore local backup  | Zeigt die vorhandenen Backups zur Auswahl, sichert den aktuellen Stand als `vor-restore-…`, stoppt den Dienst, spielt das Backup ein und startet neu.                                              |
| 8   | restart services      | Lädt die systemd-Konfiguration neu, startet `ultimate-dash.service` neu und prüft, ob das Dashboard antwortet. |
| 9   | uninstall ultimate dash | Fragt nach, bietet vorher ein Backup an, entfernt Dienst und Programmordner. Daten, Konfiguration und Backups bleiben, bis du `loeschen` eintippst. Node.js und Systempakete bleiben installiert. |
| 10  | exit                  | Beendet das Skript. |

Ohne Menü, z. B. für Automatisierung: `sudo ./install.sh <deps|install|repair|update-deps|update|backup|restore|restart|uninstall>`. Mit `UD_ASSUME_YES=1` werden Rückfragen mit „ja“ beantwortet; `UD_PURGE=1` löscht bei `uninstall` zusätzlich Daten, Konfiguration und Benutzer.

### Orte

| Was           | Pfad                                       |
| ------------- | ------------------------------------------ |
| Programm      | `/opt/ultimate-dash`                       |
| Daten         | `/var/lib/ultimate-dash`                   |
| Konfiguration | `/etc/ultimate-dash/ultimate-dash.env`     |
| Backups       | `/var/backups/ultimate-dash` (nur für root) |
| Dienst        | `systemctl status ultimate-dash`           |
| Log           | `journalctl -u ultimate-dash -f`           |

Die Variablen aus `.env.example` (Technitium, SMTP, OIDC …) trägst du in die Konfigurationsdatei ein und startest danach mit `systemctl restart ultimate-dash` neu. Orte, Branch und Quelle lassen sich mit `UD_APP_DIR`, `UD_DATA_DIR`, `UD_CONF_DIR`, `UD_BACKUP_DIR`, `UD_BRANCH` und `UD_REPO_URL` ändern; setze sie bei jedem Aufruf gleich.

Ein Backup enthält Zugangsdaten. Kopiere es für echte Sicherheit zusätzlich auf einen anderen Rechner, denn „lokal“ heißt: auf demselben Host.

Passwort vergessen: `sudo -u ultimate-dash bash -c 'set -a; . /etc/ultimate-dash/ultimate-dash.env; cd /opt/ultimate-dash/apps/server && node dist/main.js reset-link admin'` (`admin` durch den Benutzernamen ersetzen).

## Hinter einem Reverse-Proxy (HTTPS)

Ultimate Dash funktioniert hinter Caddy, Traefik, nginx oder Nginx Proxy Manager. Wichtig:

- Der Proxy muss `Host` und `X-Forwarded-Proto` weitergeben. Dann setzt Ultimate Dash das Sitzungs-Cookie automatisch als `Secure`.
- Live-Aktualisierungen laufen über Server-Sent Events. Puffern beim Proxy für `/api/events` abschalten (nginx: `proxy_buffering off;`).
- Setze `PUBLIC_URL` auf die öffentliche Adresse, wenn du Mails verschickst oder OIDC nutzt.

Beispiel für Caddy:

```
dash.example.org {
    reverse_proxy 192.168.1.20:3000
}
```

Stelle Ultimate Dash nicht ungeschützt ins Internet. Für den Zugriff von unterwegs ist ein VPN (z. B. WireGuard oder Tailscale) die bessere Wahl. Siehe auch [SECURITY.md](../../SECURITY.md).

## Passwort vergessen, einziger Admin ausgesperrt

Ein Reset-Link lässt sich auf der Kommandozeile erzeugen und im Browser öffnen:

```bash
docker exec -u node ultimate-dash node dist/main.js reset-link admin
```

`admin` durch den Benutzernamen ersetzen. Ist `PUBLIC_URL` nicht gesetzt, enthält der Link einen Platzhalter für die Adresse. `-u node` sorgt dafür, dass die Datenbankdateien dem richtigen Benutzer gehören.

## Häufige Probleme

| Problem | Lösung |
| --- | --- |
| `docker compose` kennt `-d` nicht | Compose-Plugin fehlt, siehe oben |
| `env_file` mit `required` unbekannt | Compose ist älter als 2.24: aktualisieren oder den Block `env_file` aus `docker-compose.yml` entfernen |
| „… ist für UID … nicht beschreibbar“ | Bei eigenem `user:` in der Compose-Datei: `chown -R <uid>:<gid> data` |
| Ping findet nichts | Host erreicht das Netz nicht, oder die Geräte beantworten keinen Ping |
| Icons fehlen | Browser oder Server erreichen `cdn.jsdelivr.net` bzw. `api.iconify.design` nicht |

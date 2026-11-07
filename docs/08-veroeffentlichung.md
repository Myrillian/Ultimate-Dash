# Veröffentlichung auf GitHub

> Stand: 07.11.2026. Prüfung vor der Umstellung des Repositorys auf öffentlich. Keine Rechtsberatung.

## Ergebnis

Nichts spricht gegen die Veröffentlichung. Es wurden keine Passwörter, Tokens oder privaten Schlüssel gefunden, weder im aktuellen Stand noch in der Git-Historie. Alle ausgelieferten Abhängigkeiten sind freizügig lizenziert. Fehlende Dateien (Lizenz, Hinweise, Vorlagen) sind ergänzt.

## Geprüft

### Persönliche Daten und Geheimnisse

Durchsucht wurden alle Commits aller Branches, die Commit-Autoren und die Texte aller Pull Requests.

| Prüfung | Ergebnis | Maßnahme |
| --- | --- | --- |
| Passwörter, Tokens, Schlüssel (Muster für Klartext-Passwörter, Hex-Tokens ab 40 Zeichen, UUID-Secrets, `ghp_`, `AKIA`, private Schlüssel) | nur Testwerte (`test-token`, `dev-token`, `geheimes-secret`) | keine. Nichts zu rotieren |
| E-Mail-Adressen | nur `example.org`-Adressen | keine |
| Commit-Autoren | GitHub-noreply-Adresse und `noreply@anthropic.com` | keine |
| Echter Hostname eines Proxmox-Knotens in einem Test | gefunden | durch `pve` ersetzt |
| Vorname des Inhabers in drei Docs und in `docs/04-entscheidungen.md` | gefunden | neutral formuliert |
| Private IP-Adressen (`10.10.0.53`, `10.10.0.0/23`) in Beispielen | gefunden, möglicherweise aus dem echten Netz | auf `192.168.x.x` umgestellt |
| Vorname in den PR-Beschreibungen (Zeile „Requested by …“) | vorhanden | bleibt, siehe offene Fragen |
| Binärdateien, Screenshots | keine im Repository | keine |

Die alten Werte stehen weiterhin in der Git-Historie. Weil sie nichts Geheimes enthalten (private Adressen sind aus dem Internet nicht erreichbar), wird die Historie nicht umgeschrieben.

### Rechte Dritter

| Bereich | Ergebnis |
| --- | --- |
| npm-Abhängigkeiten im Programm | MIT, ISC, Apache-2.0, BSD-2/3-Clause, BlueOak-1.0.0, MIT-0. Keine Copyleft-Lizenz |
| Nur beim Bauen | zusätzlich lightningcss (MPL-2.0), wird nicht ausgeliefert |
| Docker-Basisimage | `node:22-bookworm-slim`, Debian-Pakete unter ihren Lizenzen. Relevant erst, wenn fertige Images veröffentlicht werden |
| Kopierter Code | keine Hinweise auf übernommenen fremden Code |
| Eigene Assets | nur `favicon.svg`, selbst erstellt. Keine fremden Schriften oder Bilder |
| Icons | werden zur Laufzeit von Dashboard Icons (Apache-2.0), selfh.st (CC BY 4.0) und Iconify geladen, nicht mitgeliefert. Logos bleiben Marken ihrer Inhaber |
| OUI-Liste | öffentliche IEEE-Daten, Quelle in `NOTICE.md` genannt |
| Standard-RSS-Feeds | nur Name und Adresse mitgeliefert. Hinweis zu Urheberrecht und Leistungsschutzrecht in `docs/rechtliches.md` |
| Produktnamen (Proxmox, Technitium, Home Assistant …) | nur beschreibend genannt, Markenhinweis in `NOTICE.md` und README |
| Feature-Vergleich mit anderen Dashboards | sachlicher Vergleich, zulässig |

## Neu angelegt

- `LICENSE` (MIT), `license`-Feld in allen `package.json`, OCI-Labels und `LICENSE`/`NOTICE.md` im Docker-Image
- `NOTICE.md`: Drittanbieter, Daten, externe Quellen, Marken
- `docs/rechtliches.md`: Haftungsausschluss, Datenschutzhinweise, RSS, Marken, Impressum
- `SECURITY.md`, `CONTRIBUTING.md`
- `.github/ISSUE_TEMPLATE/` (Fehler, Idee), `.github/pull_request_template.md`
- `.env.example`, `docker-compose.yml` liest `.env` jetzt automatisch
- Anleitungen in `docs/anleitungen/`: Installation, Konfiguration, Technitium, Proxmox

Korrigiert: Die Proxmox-Anleitung vergab die Rolle `PVEAuditor` nur dem Token. Mit „Privilege Separation“ gilt aber nur die Schnittmenge aus Benutzer- und Token-Rechten, die Rolle muss also an beide. Anleitung, Hilfetext im Dialog und Fehlermeldungen nennen jetzt beide Befehle.

## Offene Fragen an den Inhaber

1. **PR-Beschreibungen:** Die bisherigen Pull Requests nennen den Vornamen in der Zeile „Requested by …“. Bei einem öffentlichen Repository sind sie sichtbar. Belassen, oder sollen die Texte angepasst werden?
2. **Private Sicherheitsmeldungen** in den Repository-Einstellungen einschalten (_Settings › Code security › Private vulnerability reporting_). `SECURITY.md` verweist darauf.
3. **Repository-Name:** Der Feed-Abruf meldet sich mit `https://github.com/myrillian/ultimate-dash`. Bleibt der Name beim Veröffentlichen gleich? GitHub ignoriert Groß- und Kleinschreibung.
4. **Fertige Docker-Images** (z. B. über GitHub Container Registry) anbieten? Dann gelten für die enthaltenen Debian-Pakete deren Lizenzpflichten, und ein Workflow zum Bauen und Veröffentlichen wäre nötig.
5. **Name „Ultimate Dash“:** Eine Markenrecherche wurde nicht gemacht. Wer sichergehen will, prüft beim DPMA und EUIPO, ob der Name für Software geschützt ist.
6. **Labels** `fehler` und `idee` in GitHub anlegen, damit die Issue-Vorlagen sie setzen können.
7. **Code of Conduct:** Für ein kleines Projekt optional. Bei Bedarf den Contributor Covenant ergänzen.

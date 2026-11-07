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

## Markenrecherche „Ultimate Dash“

Stand 07.11.2026, nur Websuche, keine Abfrage der amtlichen Register. Keine Rechtsberatung.

- Eine eingetragene Marke „Ultimate Dash“ für Software wurde nicht gefunden. Unter dem Namen gibt es ein Autopflegeprodukt, das ist eine andere Warenklasse.
- **„DASH“ allein ist mehrfach geschützt**, auch für Software (Klasse 9). Am nächsten liegt die US-Marke von Plotly für Software, die Daten grafisch darstellt (Reg.-Nr. 6874845). Plotly vertreibt darunter das Python-Framework „Dash“ für Dashboards. Weitere „DASH“-Marken halten z. B. Amazon und die Kryptowährung Dash.
- Ähnlich heißt das WordPress-Plugin „Ultimate Dashboard“.

**Einschätzung:** Für ein nicht kommerzielles Open-Source-Projekt ist das Risiko gering. „Dash“ steht hier beschreibend für Dashboard, und mit „Ultimate“ unterscheidet sich der Name. Ganz ausschließen lässt sich ein Konflikt ohne Registerabfrage nicht, vor allem bei einer späteren kommerziellen Nutzung. Für Gewissheit eine Suche in [TMview](https://www.tmdn.org/tmview/) machen (deckt DPMA, EUIPO und weitere Ämter ab, Klassen 9 und 42) oder ein Gutachten einholen.

## Erledigt nach der Veröffentlichung

- **PR-Beschreibungen:** In allen 32 Pull Requests steht jetzt „Requested by **Myrillian**“. GitHub zeigt bei bearbeiteten Beschreibungen eine Versionsliste („bearbeitet“). Alte Versionen lassen sich dort einzeln löschen (_Delete revision from history_).
- **Labels:** Die Issue-Vorlagen nutzen die vorhandenen GitHub-Standardlabels `bug` und `enhancement`.

## Offene Fragen an den Inhaber

1. **Private Sicherheitsmeldungen** einschalten, sobald das Repository öffentlich ist: _Settings › Security › Private vulnerability reporting › Enable_ (bei privaten Repositorys gibt es die Funktion nicht). `SECURITY.md` verweist darauf.
2. **Repository-Name:** Der Feed-Abruf meldet sich mit `https://github.com/myrillian/ultimate-dash`. Bleibt der Name beim Veröffentlichen gleich? GitHub ignoriert Groß- und Kleinschreibung.
3. **Fertige Docker-Images** (z. B. über GitHub Container Registry) anbieten? Dann gelten für die enthaltenen Debian-Pakete deren Lizenzpflichten, und ein Workflow zum Bauen und Veröffentlichen wäre nötig. Noch offen.
4. **Code of Conduct:** Für ein kleines Projekt optional. Bei Bedarf den Contributor Covenant ergänzen.

# RSS-Feeds

Das Dashboard zeigt Meldungen aus RSS- und Atom-Feeds. Entscheidung und Gründe: `docs/04-entscheidungen.md`, Nr. 17.

## Anzeige

- **Ab 1280 px Breite:** Leiste „Neuigkeiten“ rechts neben den Gruppen (22rem, bleibt beim Scrollen stehen). Eingeklappt bleibt ein schmaler Streifen mit der Zahl neuer Meldungen.
- **Darunter (Tablet, Smartphone):** einklappbarer Bereich unter den Gruppen, standardmäßig eingeklappt.
- Filter-Chips je Thema, Meldung mit Vorschaubild (sonst farbiger Anfangsbuchstabe der Quelle), Titel, Quelle und Alter. Ein Punkt markiert Meldungen, die seit dem letzten Öffnen dazugekommen sind.
- Im Bearbeiten-Modus ausgeblendet. Über das Benutzermenü lässt sich die Anzeige ganz aus- und wieder einblenden.
- Neue Meldungen kommen über die Live-Verbindung (`feeds-changed`).

## Verwaltung (Admins)

Einstellungen → „Verbindungen › Feeds verwalten“ oder Zahnrad in der Leiste: Feed per Adresse prüfen und hinzufügen, Name, Thema und Adresse ändern, aktivieren/deaktivieren, sofort abrufen, entfernen. „Standardfeeds wiederherstellen“ legt gelöschte Standardfeeds wieder an. Änderungen stehen im Protokoll (`feeds.*`).

## Server

| Route | Zweck |
| --- | --- |
| `GET /api/feeds/items?topic=&before=&limit=` | Meldungen aktiver Feeds, neueste zuerst |
| `GET /api/feeds/images/:id` | Vorschaubild einer gespeicherten Meldung |
| `GET /api/feeds` | Feeds mit Abrufstatus |
| `POST /api/feeds/preview` | Adresse prüfen, ohne zu speichern (Admin) |
| `POST /api/feeds`, `PUT /api/feeds/:id`, `DELETE /api/feeds/:id` | Verwalten (Admin) |
| `POST /api/feeds/:id/refresh`, `POST /api/feeds/defaults` | Sofort abrufen, Standardfeeds ergänzen (Admin) |

Unterstützt werden RSS 2.0, RSS 1.0 (RDF) und Atom. Bilder kommen aus `media:thumbnail`, `media:content`, Bild-Enclosures oder dem ersten `<img>` im Inhalt; Zählpixel (≤ 2 px) werden übersprungen. Links werden nur als http(s) übernommen.

## Standardfeeds (40)

Geprüft am 07.11.2026 per Abruf: ✓ = gültiger Feed mit aktuellen Einträgen; ◯ = bekannter offizieller Feed, die Seite sperrt aber automatische Prüfabrufe (robots.txt), daher nicht maschinell bestätigt. 🖼 = Feed liefert Vorschaubilder.

### Security

| # | Name | URL | |
|---|---|---|---|
| 1 | heise Security | https://www.heise.de/security/rss/news-atom.xml | ◯ |
| 2 | Golem Security | https://rss.golem.de/rss.php?tp=sec&feed=ATOM1.0 | ✓ |
| 3 | Krebs on Security | https://krebsonsecurity.com/feed/ | ✓ 🖼 |
| 4 | Schneier on Security | https://www.schneier.com/feed/atom/ | ✓ |
| 5 | The Hacker News | https://feeds.feedburner.com/TheHackersNews | ✓ 🖼 |
| 6 | BleepingComputer | https://www.bleepingcomputer.com/feed/ | ✓ |
| 7 | Dark Reading | https://www.darkreading.com/rss.xml | ✓ 🖼 |
| 8 | SANS Internet Storm Center | https://isc.sans.edu/rssfeed_full.xml | ✓ |
| 9 | SecurityWeek | https://www.securityweek.com/feed/ | ✓ |
| 10 | Troy Hunt | https://www.troyhunt.com/rss/ | ✓ 🖼 |

### Smart-Home

| # | Name | URL | |
|---|---|---|---|
| 1 | Home Assistant Blog | https://www.home-assistant.io/atom.xml | ✓ 🖼 |
| 2 | simon42 | https://www.simon42.com/feed/ | ✓ |
| 3 | SmarthomeAssistent | https://smarthomeassistent.de/feed/ | ✓ 🖼 |
| 4 | matter-smarthome.de | https://www.matter-smarthome.de/feed/ | ✓ 🖼 |
| 5 | SmartDroid | https://www.smartdroid.de/feed/ | ✓ 🖼 |
| 6 | Hackaday – Home Hacks | https://hackaday.com/category/home-hacks/feed/ | ✓ 🖼 |
| 7 | CNX Software (Embedded & IoT) | https://www.cnx-software.com/feed/ | ✓ 🖼 |
| 8 | ESPHome Releases | https://github.com/esphome/esphome/releases.atom | ◯ |
| 9 | Zigbee2MQTT Releases | https://github.com/Koenkk/zigbee2mqtt/releases.atom | ◯ |
| 10 | The Verge – Smart Home | https://www.theverge.com/rss/smart-home/index.xml | ◯ |

### Netzwerk

| # | Name | URL | |
|---|---|---|---|
| 1 | Packet Pushers | https://feeds.packetpushers.net/packetpushersfullfeed | ✓ |
| 2 | Cloudflare Blog | https://blog.cloudflare.com/rss/ | ✓ 🖼 |
| 3 | APNIC Blog | https://blog.apnic.net/feed/ | ✓ |
| 4 | RIPE Labs | https://labs.ripe.net/rss/ | ✓ |
| 5 | ipSpace.net (Ivan Pepelnjak) | https://blog.ipspace.net/atom.xml | ✓ 🖼 |
| 6 | Netgate (pfSense) Blog | https://www.netgate.com/blog/rss.xml | ✓ 🖼 |
| 7 | Technitium Blog | https://blog.technitium.com/feeds/posts/default | ✓ 🖼 |
| 8 | ServeTheHome | https://www.servethehome.com/feed/ | ✓ |
| 9 | Tailscale Blog | https://tailscale.com/blog/index.xml | ✓ |
| 10 | IP-Insider | https://www.ip-insider.de/rss/news.xml | ◯ |

### IT

| # | Name | URL | |
|---|---|---|---|
| 1 | heise online | https://www.heise.de/rss/heise-atom.xml | ◯ |
| 2 | Golem.de | https://rss.golem.de/rss.php?feed=ATOM1.0 | ✓ |
| 3 | ComputerBase | https://www.computerbase.de/rss/news.xml | ✓ 🖼 |
| 4 | t3n | https://t3n.de/rss.xml | ✓ 🖼 |
| 5 | Caschys Blog | https://stadt-bremerhaven.de/feed/ | ✓ 🖼 |
| 6 | Borns IT- und Windows-Blog | https://www.borncity.com/blog/feed/ | ✓ |
| 7 | LWN.net | https://lwn.net/headlines/rss | ✓ |
| 8 | Hacker News (Startseite) | https://news.ycombinator.com/rss | ✓ |
| 9 | selfh.st (Self-Hosting) | https://selfh.st/rss/ | ✓ 🖼 |
| 10 | Ars Technica | https://feeds.arstechnica.com/arstechnica/index | ◯ |

Aussortiert, weil leer oder ohne Feed: OPNsense-News (Feed ohne Einträge), Pi-hole-Blog (leerer Feed), homeandsmart.de (nur Bot-Schutzseite). Die ◯-Feeds prüft der Server nach dem Einspielen ohnehin selbst; wer nicht funktioniert, steht dann mit Fehler in der Verwaltung.

Für Meldungen ohne eigenes Bild (z. B. Schneier, BleepingComputer, LWN) wird das Favicon der Quelle angezeigt.


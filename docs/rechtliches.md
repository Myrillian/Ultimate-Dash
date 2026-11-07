# Rechtliche Hinweise

> **Keine Rechtsberatung.** Diese Seite fasst zusammen, wie das Projekt mit Lizenzen, Daten und fremden Inhalten umgeht. Sie ersetzt keine Beratung durch eine Anwältin oder einen Anwalt. Wer Ultimate Dash öffentlich, für andere oder gewerblich betreibt, prüft die eigenen Pflichten selbst.

## Lizenz und Haftung

Ultimate Dash steht unter der [MIT-Lizenz](../LICENSE). Du darfst es nutzen, ändern und weitergeben, auch gewerblich, solange der Lizenz- und Copyright-Hinweis erhalten bleibt.

Die Software wird so bereitgestellt, wie sie ist, ohne Gewähr. Ultimate Dash kann in Technitium DNS-Einträge, DHCP-Reservierungen und Blocking-Einstellungen ändern. Ein Fehler oder eine falsche Eingabe kann dein Netz stören. Lege vorher Backups von Technitium und vom Datenordner an. Soweit gesetzlich zulässig, haften die Autoren nicht für Schäden aus der Nutzung. Zwingende gesetzliche Haftung, etwa bei Vorsatz, bleibt davon unberührt.

Fremde Software und Marken stehen in [NOTICE.md](../NOTICE.md).

## Datenschutz

Ultimate Dash läuft vollständig auf deinem eigenen Server. Das Projekt betreibt keine eigenen Dienste, sammelt keine Nutzungsdaten und hat keine Telemetrie. Verantwortlich im Sinne der DSGVO ist, wer die Instanz betreibt.

**Was gespeichert wird** (in der SQLite-Datei im Datenordner):

- Benutzerkonten: Benutzername, Rolle, optional E-Mail-Adresse, Passwort als scrypt-Hash, bei SSO die Kennung des Anbieters (`sub`)
- Sitzungen (30 Tage) und Reset-Links, beides nur als Hash
- Änderungsprotokoll: wer wann was an Technitium oder im IPAM geändert hat, ein Jahr lang
- Netzdaten: IP-Adressen, MAC-Adressen und Hostnamen aus Technitium und aus der Ping-Prüfung. MAC-Adressen und Hostnamen können personenbezogen sein, etwa das Handy einer bestimmten Person.
- Zugangsdaten für Technitium, Proxmox und Mailserver im Klartext, damit der Server sie nutzen kann. Schütze den Datenordner und die Backups entsprechend.
- RSS-Meldungen der letzten 14 Tage

Fehlversuche bei der Anmeldung (Benutzername und IP-Adresse) hält der Server nur 15 Minuten im Arbeitsspeicher, nicht in der Datenbank.

Im Browser legt Ultimate Dash ein Sitzungs-Cookie (technisch notwendig) und einige Anzeige-Einstellungen im `localStorage` ab, etwa das Farbschema oder die gewählte Größe des DNS-Bereichs.

**Verbindungen nach außen:**

| Ziel | Von | Wann | Was der Empfänger sieht |
| --- | --- | --- | --- |
| jsDelivr (`cdn.jsdelivr.net`), ersatzweise GitHub | Server | einmal am Tag | IP des Servers (Abruf der Icon-Listen) |
| jsDelivr | Browser | beim Anzeigen von `di:`- und `sh:`-Icons | IP und Browser der Besucher |
| Iconify (`api.iconify.design`) | Browser | beim Anzeigen und Suchen von Iconify-Icons | IP, Browser, Suchbegriff |
| RSS-Anbieter | Server | alle 30 Minuten je Feed, Vorschaubilder bei Bedarf | IP des Servers, User-Agent `UltimateDash-Feeds/1.0` |
| Statusprüfungen | Server | laufend | nur die Ziele, die du selbst einträgst |
| Eigene Bild-URLs als Icon | Browser | beim Anzeigen | IP und Browser der Besucher |

Wer keine Abrufe aus dem Browser an Dritte möchte, verwendet nur Initialen-Icons oder eigene Bild-URLs aus dem eigenen Netz. Die Feeds lassen sich unter Einstellungen › _Feeds verwalten_ abschalten oder löschen.

Wer eine Instanz für andere Personen betreibt (Familie, Verein, Firma), sollte sie über diese Verarbeitung informieren und je nach Lage eine eigene Datenschutzerklärung bereitstellen.

## RSS-Feeds

Beim ersten Start trägt Ultimate Dash 40 öffentliche Feeds ein. Mitgeliefert werden nur Name und Adresse, keine Inhalte. Der Server ruft die Feeds ab, speichert Titel, Link, Datum und einen kurzen Anriss (reiner Text) für 14 Tage und hält Vorschaubilder höchstens im Arbeitsspeicher. Jede Meldung verlinkt auf den Originalartikel.

Für die private Nutzung im eigenen Netz ist das die übliche Art, einen Feed-Reader zu betreiben. Die Inhalte bleiben urheberrechtlich geschützt. Wer das Dashboard öffentlich zugänglich macht oder gewerblich nutzt, prüft die Nutzungsbedingungen der einzelnen Anbieter. Für Presseinhalte kann dann außerdem das Leistungsschutzrecht für Presseverleger (§§ 87f ff. UrhG) gelten. Im Zweifel die betroffenen Feeds entfernen.

## Marken und Namen

Produktnamen wie Proxmox, Technitium oder Home Assistant werden nur genannt, um zu beschreiben, womit Ultimate Dash zusammenarbeitet. Das Projekt verwendet keine fremden Logos im eigenen Erscheinungsbild. Icons, die du für deine Services auswählst, lädt der Browser aus den genannten Sammlungen. Die Logos darin bleiben Marken ihrer Inhaber.

## Impressum

Ein öffentliches GitHub-Repository eines privaten, nicht gewerblichen Projekts braucht in der Regel kein Impressum. Wer eine Instanz öffentlich und geschäftsmäßig anbietet, kann nach § 5 DDG impressumspflichtig sein.

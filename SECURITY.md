# Sicherheit

## Sicherheitslücken melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue. Nutze stattdessen die private Meldung von GitHub: im Repository unter _Security › Report a vulnerability_.

Hilfreich sind:

- betroffene Version oder Commit
- Schritte zum Nachstellen
- was ein Angreifer damit erreichen kann

Ultimate Dash ist ein Freizeitprojekt. Ich bestätige Meldungen so bald wie möglich und behebe bestätigte Lücken vorrangig. Feste Fristen kann ich nicht zusagen. Nach dem Fix wird die Lücke im Changelog bzw. in einem GitHub Security Advisory beschrieben, auf Wunsch mit Nennung der meldenden Person.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für den aktuellen Stand von `main`.

## Hinweise für den Betrieb

- Ultimate Dash ist für das eigene Netz gedacht. Stelle es nicht ungeschützt ins Internet. Wenn es von außen erreichbar sein soll, dann nur über einen Reverse-Proxy mit HTTPS, besser zusätzlich hinter VPN oder SSO.
- Der Datenordner (`./data`) enthält die Zugangsdaten zu Technitium, Proxmox und dem Mailserver im Klartext. Schütze ihn und seine Backups.
- Gib Tokens nur die Rechte, die sie brauchen (siehe [Technitium](docs/anleitungen/technitium.md) und [Proxmox](docs/anleitungen/proxmox.md)).
- `*_TLS_INSECURE=true` schaltet die Zertifikatsprüfung ab. Nutze das nur im eigenen Netz und nur, wenn es nicht anders geht.

# Proxmox VE

Das Dashboard zeigt die Kernwerte eines Proxmox-Hosts. Der Zugriff ist rein lesend und nur für Admins sichtbar. Entscheidung und Gründe: `docs/04-entscheidungen.md`, Nr. 19.

## Anzeige

Unter dem DNS-Bereich, über den Gruppen, in zwei Größen (Umschalter rechts, Wahl pro Browser):

- **Balken (Standard):** eine Zeile mit CPU, RAM, Netz ein/aus, Disk lesen/schreiben, Storage belegt/gesamt sowie „VMs 4/6“ und „CTs 12/15“. Überfahren, Fokussieren oder Antippen von VMs/CTs zeigt die nicht gestarteten Gäste mit ID und Name. Auf schmalen Bildschirmen bleiben CPU, RAM (als Prozent) und die Gäste; Netz, Storage und Disk erscheinen mit zunehmender Breite.
- **Kompakt:** sechs Kacheln (CPU mit Verlauf der letzten Stunde, RAM mit Balken, Netzwerk mit Verlauf, Storage-I/O, VMs, Container mit den ersten fünf gestoppten Gästen) und darunter je Datastore ein Balken, vollste zuerst. Ab 85 % gelb, ab 95 % rot.

Ist Proxmox nicht verbunden, sehen Admins einen Hinweis „Proxmox VE verbinden“. Bei einem Fehler bleibt der letzte Stand sichtbar und abgeblendet. Ein Knoten offline wird rot markiert.

## Einrichten

Einstellungen › „Verbindungen › Proxmox VE“: Adresse (`https://pve.home.lan:8006`), Token-ID (`benutzer@realm!tokenname`), Secret, optional „Zertifikat nicht prüfen“. „Verbindung prüfen“ zeigt Version, Knoten und Anzahl der Gäste; gespeichert wird nur eine funktionierende Verbindung. Darf das Token mehr als lesen, erscheint eine Warnung.

Token in der Proxmox-Shell anlegen:

```sh
pveum user add dashboard@pve
pveum user token add dashboard@pve ultimate-dash --privsep 1
pveum acl modify / --tokens 'dashboard@pve!ultimate-dash' --roles PVEAuditor
```

Mit „Privilege Separation“ braucht das Token die Rolle selbst. Fehlt sie, liefert Proxmox keinen Fehler, sondern eine leere Liste; Ultimate Dash meldet dann „Das Token sieht keinen Knoten“.

Alternativ per Umgebungsvariablen `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`, `PROXMOX_TLS_INSECURE=true`. Dann ist die Verbindung in der Oberfläche nur lesbar.

## Woher die Werte kommen

| Proxmox-Endpunkt | Verwendung |
| --- | --- |
| `GET /cluster/resources` | Knoten (CPU, Kerne, RAM, Laufzeit), VMs und Container (Status, Disk-Zähler), Storages (belegt, gesamt) |
| `GET /nodes/{node}/rrddata?timeframe=hour&cf=AVERAGE` | Netzwerkdurchsatz des Hosts (letzter vollständiger Minutenwert) und Verlauf für CPU und Netz |
| `GET /version` | nur beim Verbindungstest |
| `GET /access/permissions` | nur beim Verbindungstest, Warnung bei Rechten außer `*.Audit` |

- **CPU** im Cluster nach Kernen gewichtet, beim Einzelhost der Wert des Knotens.
- **Storage-I/O:** Proxmox liefert keinen Disk-Durchsatz für den Host. Der Server merkt sich die Zähler `diskread`/`diskwrite` der laufenden Gäste und rechnet aus der Differenz zum letzten Abruf die Rate („Summe der Gäste“). Der erste Wert kommt daher mit dem zweiten Abruf; liegt der letzte Abruf mehr als 2 Minuten zurück, wird neu angesetzt statt über Stunden zu mitteln. Neustarts (Zähler fällt) zählen als 0.
- **Vorlagen** (`template = 1`) zählen nicht als VM oder Container.
- **Geteilte Storages** (NFS, Ceph …) zählen nur einmal, auch wenn sie an mehreren Knoten hängen.

## Server

| Route | Zweck |
| --- | --- |
| `GET /api/proxmox/summary` | Kennzahlen (`ProxmoxSummary`) |
| `GET /api/proxmox/settings` | Adresse, Token-ID, „Secret gesetzt“, Zertifikat-Option, Quelle |
| `PUT /api/proxmox/settings`, `DELETE /api/proxmox/settings` | Speichern (nur nach erfolgreichem Test) und Trennen |
| `POST /api/proxmox/test` | Zugang prüfen, ohne zu speichern |

Alle Routen nur für Admins. Zwischenspeicher 8 Sekunden, der Browser fragt alle 10 Sekunden, solange der Tab sichtbar ist. Ohne offenes Dashboard fragt der Server Proxmox nicht ab. Verbinden und Trennen stehen im Änderungsprotokoll (`proxmox.connect`, `proxmox.disconnect`).

## Sicherheit

- Der Client im Server (`apps/server/src/proxmox/client.ts`) kennt nur GET und eine feste Liste von Pfaden. Selbst ein Token mit zu vielen Rechten kann so nichts verändern.
- Das Secret geht nur im `Authorization`-Header an Proxmox, nie in der Adresse. Es wird nie an den Browser zurückgegeben und ist nicht Teil des Dashboard-Exports.
- Ein gespeichertes Secret gilt nur für die gespeicherte Token-ID; wer die Token-ID ändert, muss das Secret neu eingeben.

## Entwicklung

`pnpm --filter @ultimate-dash/server fake:proxmox` startet einen simulierten Proxmox auf Port 8006 (Token-ID `dashboard@pve!ultimate-dash`, Secret `geheimes-secret`).

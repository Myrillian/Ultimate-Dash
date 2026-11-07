# Proxmox VE anbinden

Ultimate Dash zeigt Admins die Kernwerte eines Proxmox-Hosts oder -Clusters: CPU, RAM, Netzwerk- und Storage-Durchsatz, belegten Platz der Datastores sowie laufende und gestoppte VMs und Container. Der Zugriff ist **rein lesend**. Der Server ruft nur eine feste Liste von `GET`-Pfaden ab, selbst ein Token mit zu vielen Rechten kann darüber nichts ändern.

Du brauchst einen Benutzer und ein API-Token mit der Rolle **PVEAuditor**. Diese Rolle darf nur lesen. Starten, Stoppen oder die Konsole sind damit nicht möglich.

## Wichtig: Rechte für Benutzer und Token

Ein Token mit „Privilege Separation“ (empfohlen) hat **nur die Rechte, die Benutzer und Token beide haben**. Proxmox bildet die Schnittmenge. Die Rolle muss deshalb zweimal vergeben werden:

- einmal für den **Benutzer** `dashboard@pve`
- einmal für das **Token** `dashboard@pve!ultimate-dash`

Fehlt eine der beiden Vergaben, meldet Proxmox keinen Fehler, sondern liefert Knoten nur mit Name und Status, ohne CPU, RAM, Gäste und Storages. Ultimate Dash erkennt das und meldet „Das Token sieht keinen Knoten“ bzw. „… aber keine Werte“, statt Nullen anzuzeigen.

## Variante A: in der Proxmox-Shell

Auf einem Knoten unter _Knoten_ › _Shell_ (oder per SSH als root):

```sh
# 1. Benutzer im Realm „pve“ anlegen (ohne Passwort, kann sich also nicht anmelden)
pveum user add dashboard@pve --comment "Ultimate Dash, nur lesen"

# 2. Token mit Privilege Separation anlegen. Gibt das Secret aus („value“), nur dieses eine Mal!
pveum user token add dashboard@pve ultimate-dash --privsep 1 --comment "Ultimate Dash"

# 3. Rolle PVEAuditor auf „/“ für den Benutzer …
pveum acl modify / --users 'dashboard@pve' --roles PVEAuditor

# 4. … und für das Token vergeben
pveum acl modify / --tokens 'dashboard@pve!ultimate-dash' --roles PVEAuditor

# Kontrolle: muss Sys.Audit, VM.Audit und Datastore.Audit auf „/“ zeigen
pveum user token permissions dashboard@pve ultimate-dash
```

Die einfachen Anführungszeichen um `dashboard@pve!ultimate-dash` sind nötig, weil die Shell `!` sonst auswertet.

## Variante B: in der Weboberfläche

1. _Rechenzentrum_ › _Berechtigungen_ › _Benutzer_ › _Hinzufügen_: Benutzername `dashboard`, Realm _Proxmox VE authentication server_ (`pve`), kein Passwort nötig.
2. _Rechenzentrum_ › _Berechtigungen_ › _API-Token_ › _Hinzufügen_: Benutzer `dashboard@pve`, Token-ID `ultimate-dash`, **Privilege Separation** angehakt lassen. Das angezeigte Secret sofort kopieren, es erscheint nur einmal.
3. _Rechenzentrum_ › _Berechtigungen_ › _Hinzufügen_ › **Benutzer-Berechtigung**: Pfad `/`, Benutzer `dashboard@pve`, Rolle `PVEAuditor`, _Weitergeben_ angehakt.
4. _Rechenzentrum_ › _Berechtigungen_ › _Hinzufügen_ › **API-Token-Berechtigung**: Pfad `/`, API-Token `dashboard@pve!ultimate-dash`, Rolle `PVEAuditor`, _Weitergeben_ angehakt.

In der Liste unter _Berechtigungen_ stehen danach zwei Zeilen mit `PVEAuditor` auf `/`: eine für den Benutzer, eine für das Token.

> **Ohne Privilege Separation** erbt das Token alle Rechte des Benutzers, dann reicht Schritt 3. Das ist nur sinnvoll, wenn der Benutzer selbst ausschließlich `PVEAuditor` hat. Gib einem solchen Token nie einen Benutzer wie `root@pam`.

## In Ultimate Dash eintragen

Einstellungen › _Verbindungen_ › _Proxmox VE_:

| Feld | Beispiel |
| --- | --- |
| Adresse | `https://pve.home.lan:8006` |
| Token-ID | `dashboard@pve!ultimate-dash` (Benutzer, `!`, Token-Name) |
| Secret | die UUID aus Schritt 2 |
| Zertifikat nicht prüfen | nur beim selbst signierten Standardzertifikat von Proxmox |

_Verbindung prüfen_ zeigt Version, Knoten und Anzahl der Gäste. Gespeichert wird nur eine funktionierende Verbindung. Hat das Token mehr als Leserechte, erscheint eine Warnung. Ultimate Dash funktioniert dann trotzdem, gib dem Token aber besser nur `PVEAuditor`.

### Alternativ per Umgebungsvariablen

```bash
PROXMOX_URL=https://pve.home.lan:8006
PROXMOX_TOKEN_ID=dashboard@pve!ultimate-dash
PROXMOX_TOKEN_SECRET=<secret>
# PROXMOX_TLS_INSECURE=true
```

In `.env` ist `!` kein Problem. Die Verbindung ist dann in der Oberfläche nur lesbar.

## Cluster

Bei einem Cluster reicht die Verbindung zu einem Knoten. Benutzer, Token und Rechte gelten clusterweit, und Ultimate Dash liest über `/cluster/resources` alle Knoten. Die CPU wird dabei nach Kernen gewichtet. Fällt genau der eingetragene Knoten aus, gibt es keine Werte. Wer das vermeiden will, trägt eine Adresse ein, die auf einen erreichbaren Knoten zeigt (z. B. per DNS-Round-Robin oder Reverse-Proxy).

## Ausprobieren ohne echten Server

```bash
pnpm --filter @ultimate-dash/server fake:proxmox
```

startet eine Simulation auf Port 8006 (Token-ID `dashboard@pve!ultimate-dash`, Secret `geheimes-secret`).

## Fehlerbilder

| Meldung | Ursache |
| --- | --- |
| „Token-ID oder Secret sind falsch, oder das Token ist abgelaufen“ | Tippfehler in der Token-ID (Groß-/Kleinschreibung, Realm), falsches Secret, Token gelöscht oder abgelaufen |
| „Das Token sieht keinen Knoten“ oder „… aber keine Werte“ | Rolle fehlt beim Benutzer **oder** beim Token, siehe oben. Mit `pveum user token permissions` prüfen |
| „Dem Token fehlen Rechte“ | wie oben |
| Zertifikatsfehler | _Zertifikat nicht prüfen_ aktivieren oder ein gültiges Zertifikat in Proxmox einrichten |
| Nicht erreichbar | Port 8006 vom Docker-Host aus prüfen: `curl -k https://<adresse>:8006` |

Weitere technische Details (abgefragte Endpunkte, Berechnung der Werte): [docs/07-proxmox.md](../07-proxmox.md).

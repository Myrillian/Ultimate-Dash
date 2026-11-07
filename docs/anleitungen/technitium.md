# Technitium DNS anbinden

Ultimate Dash nutzt die HTTP-API von [Technitium DNS Server](https://technitium.com/dns/) für DNS-Statistik, Blocking, Zonen und Records, DHCP und die Belegung im IPAM. Alle Anfragen laufen über den Server von Ultimate Dash. Das Token gelangt nie in den Browser.

## 1. Benutzer für Ultimate Dash anlegen

Empfohlen ist ein eigener Benutzer, damit du die Rechte gezielt vergeben und das Token jederzeit sperren kannst.

1. In Technitium als Administrator anmelden.
2. _Administration_ › _Users_ › _Add User_, z. B. Benutzername `ultimate-dash`, ein langes Zufallspasswort (wird danach nicht mehr gebraucht).

## 2. Rechte vergeben

Unter _Administration_ › _Permissions_ für jeden benötigten Bereich den Benutzer hinzufügen und die Häkchen setzen. Vergib nur, was du nutzen willst:

| Funktion in Ultimate Dash | Bereich in Technitium | Rechte |
| --- | --- | --- |
| DNS-Statistik, Top-Listen | Dashboard | View |
| Blocking-Status anzeigen | Settings | View |
| Blocking pausieren, aus/ein, Blocklisten aktualisieren | Settings | View, Modify |
| Zonen und Records ansehen, IPAM-Belegung aus DNS | Zones | View |
| Records anlegen und ändern | Zones | View, Modify |
| Records löschen | Zones | View, Modify, Delete |
| DHCP-Scopes, Leases, Reservierungen ansehen, IPAM-Belegung aus DHCP | DhcpServer | View |
| Reservierungen anlegen, Leases umwandeln, Scopes ein/aus | DhcpServer | View, Modify |
| Reservierungen löschen, Leases freigeben | DhcpServer | View, Modify, Delete |

Nur lesen (Dashboard ohne Änderungen): _Dashboard_, _Settings_, _Zones_ und _DhcpServer_ jeweils mit _View_.

Für einzelne Zonen lassen sich Rechte auch direkt an der Zone vergeben (_Zones_ › Zone › _Permissions_), etwa wenn Ultimate Dash nur `home.lan` ändern darf.

## 3. API-Token erzeugen

1. _Administration_ › _Sessions_ › _Create Token_.
2. Benutzer `ultimate-dash` wählen, als Namen z. B. `Ultimate Dash` eintragen.
3. Das angezeigte Token kopieren. Technitium zeigt es nur einmal an.

Ein API-Token läuft nicht ab. Sperren kannst du es unter _Administration_ › _Sessions_ durch Löschen der Sitzung.

## 4. In Ultimate Dash eintragen

Einstellungen › _Verbindungen_ › _Technitium DNS_:

- **Adresse** der Weboberfläche, z. B. `http://192.168.1.53:5380` oder `https://dns.home.lan:53443`
- **API-Token** aus Schritt 3
- **Zertifikat nicht prüfen** nur bei HTTPS mit selbst signiertem Zertifikat

Gespeichert wird nur, wenn die Verbindung klappt. Fehlen Rechte, meldet Ultimate Dash das an der jeweiligen Stelle, statt leere Werte zu zeigen.

### Alternativ per Umgebungsvariablen

```bash
TECHNITIUM_URL=http://192.168.1.53:5380
TECHNITIUM_TOKEN=<token>
# TECHNITIUM_TLS_INSECURE=true
```

Dann ist die Hauptverbindung in der Oberfläche nur lesbar. Weitere DHCP-Server richtest du weiterhin in der Oberfläche ein.

## Mehrere Technitium-Server

DNS (Statistik, Zonen, Records, Blocking) kommt immer von der **Hauptverbindung**. DHCP kann Ultimate Dash dagegen von mehreren Servern lesen und verwalten, etwa wenn zwei Technitium-Instanzen jeweils eigene Scopes verteilen.

1. Auf jedem weiteren Server Benutzer, Rechte (_DhcpServer_) und Token wie oben anlegen.
2. In Ultimate Dash die Seite **DHCP** öffnen (Netzwerk › _Scopes_) und auf das Zahnrad _DHCP-Server verwalten_ klicken.
3. Server hinzufügen: Name (z. B. `dns2`), Adresse und eigenes Token.
   - **Token der Hauptverbindung verwenden** passt nur, wenn das Token auch auf diesem Server gilt, zum Beispiel in einem Technitium-Cluster, der Benutzer und Sitzungen abgleicht.

Sobald Scopes von mehr als einem Server kommen, zeigen DHCP-Seite und IPAM überall an, von welchem Server ein Eintrag stammt. Fällt ein Server aus, erscheint ein Hinweis, die übrigen werden weiter angezeigt.

## Ausprobieren ohne echten Server

```bash
pnpm --filter @ultimate-dash/server fake:technitium
```

startet eine Simulation auf Port 5380 mit dem Token `dev-token`. In Ultimate Dash dann `http://localhost:5380` eintragen.

## Fehlerbilder

| Meldung | Ursache |
| --- | --- |
| „Das API-Token ist ungültig oder abgelaufen“ | Token falsch, gelöscht oder von einem anderen Server |
| „Technitium verlangt eine Zwei-Faktor-Anmeldung“ | Statt eines Tokens wurde ein Passwort-Login versucht. Ein API-Token aus Schritt 3 verwenden |
| „… keine Berechtigung in Technitium“ | Dem Benutzer fehlt das Recht für diesen Bereich, siehe Tabelle oben |
| Nicht erreichbar | Adresse, Port oder Firewall. Vom Docker-Host prüfen: `curl http://<adresse>:5380` |
| Zertifikatsfehler | Selbst signiertes Zertifikat: _Zertifikat nicht prüfen_ aktivieren oder ein gültiges Zertifikat einrichten |

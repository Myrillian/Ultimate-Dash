# IPAM mit Technitium-DNS-Integration

> Stand: 05.11.2026. Lebendes Dokument, Arbeitsfassung im Projekt-Dokument.

Ziel: Ein vollständiges IPAM im Dashboard, das seine Daten aus Technitium DNS Server holt, strukturiert anzeigt und DNS-Einträge, DHCP-Leases und DHCP-Reservierungen erstellen, bearbeiten und löschen kann. Dazu Blocking-Steuerung und Statistik-Grafiken. Keine der sechs analysierten Lösungen bietet das: Homepage hat nur ein Technitium-Widget mit bis zu vier Zählern (z. B. Queries, Blocked), Dashy keins.

Grundlage ist die offizielle API-Doku (`APIDOCS.md` im Repo TechnitiumSoftware/DnsServer, Stand 05.11.2026). Die Web-Konsole von Technitium nutzt selbst diese API, also ist alles, was die Konsole kann, auch per API machbar.

## API-Grundlagen

- HTTP-API auf Port 5380, `GET` oder `POST` (Form-Daten), Antworten als JSON mit `status`: `ok`, `error` (mit `errorMessage`), `invalid-token`, `2fa-required`.
- Auth ab v15 per Header `Authorization: Bearer <token>`. Dauerhafte API-Tokens über `/api/user/createToken` oder in der Konsole.
- Feingranulare Rechte pro Bereich (Dashboard, Zones, DhcpServer, Settings, Logs …) mit View/Modify/Delete. Empfehlung: eigener API-Benutzer nur mit den nötigen Rechten.
- Cluster-Unterstützung: fast alle Aufrufe akzeptieren `node`; `node=cluster` liefert aggregierte Statistiken aller Knoten.
- Achtung bei „set“-Aufrufen: sie überschreiben den kompletten Wert (z. B. alle Reservierungen eines Scopes). Vorher lesen, ändern, zurückschreiben.

## Was die API für das IPAM liefert

| Bereich | Endpunkte | Lesen | Erstellen | Bearbeiten | Löschen |
| --- | --- | --- | --- | --- | --- |
| Zonen | `zones/list`, `create`, `enable`, `disable`, `delete`, `import`, `export`, `clone` | ✅ | ✅ | ✅ (Optionen, Typ) | ✅ |
| DNS-Einträge | `zones/records/get` (`listZone=true` für ganze Zone), `add`, `update`, `delete` | ✅ | ✅ | ✅ | ✅ |
| DHCP-Scopes | `dhcp/scopes/list`, `get`, `set`, `enable`, `disable`, `delete` | ✅ | ✅ (via `set`) | ✅ | ✅ |
| DHCP-Leases | `dhcp/leases/list`, `remove`, `convertToReserved`, `convertToDynamic` | ✅ | ❌ (vergibt der Server) | ◐ (nur umwandeln) | ✅ |
| DHCP-Reservierungen | `dhcp/scopes/addReservedLease`, `removeReservedLease`, `reservedLeases` in `scopes/get`/`set` | ✅ | ✅ | ◐ (entfernen + neu anlegen oder Scope-`set`) | ✅ |
| Blocking | `blocked/*`, `allowed/*`, `settings/temporaryDisableBlocking`, `settings/forceUpdateBlockLists`, `settings/set` | ✅ | ✅ | ✅ | ✅ |
| Statistiken | `dashboard/stats/get`, `stats/getTop`, `metrics/json`, `metrics/text` (Prometheus) | ✅ | – | – | ✅ (`deleteAll`) |
| Query-Logs | `logs/query`, `logs/export` | ✅ (über Log-App) | – | – | – |
| Health | `dnsClient/healthCheck`, `dnsClient/resolve` | ✅ | – | – | – |

**DNS-Einträge im Detail:** Unterstützt werden A, AAAA, NS, CNAME, PTR, MX, TXT, SRV, DNAME, DS, SSHFP, TLSA, SVCB, HTTPS, URI, CAA, NAPTR, RP sowie die Technitium-eigenen Typen ANAME, FWD (bedingte Weiterleitung) und APP; unbekannte Typen als Hex (`rdata`). Pro Eintrag: TTL, Kommentar, Deaktivieren, automatisches Ablaufen (`expiryTtl`). Bei A/AAAA kann der passende PTR-Eintrag automatisch mit angelegt werden (`ptr=true`, optional inkl. Reverse-Zone). `update` braucht den alten und den neuen Wert (z. B. `value` und `newValue`) und kann auch umbenennen (`newDomain`).

**DHCP im Detail:** Ein Scope liefert Bereich (Start/Ende), Subnetzmaske, Lease-Dauer, Gateway, DNS-, NTP- und WINS-Server, Domain und Suchliste, statische Routen, PXE/TFTP-Optionen, generische Optionen, Ausschlussbereiche, Reservierungen (Hostname, MAC, IP, Kommentar) sowie Schalter wie „nur Reservierungen“ und Ping-Check vor der Vergabe. Mit `dnsUpdates` legt der DHCP-Server selbst A- und PTR-Einträge für Leases an. Leases enthalten Scope, Typ (Dynamic/Reserved), MAC, Client-ID, IP, Hostname, Vergabe- und Ablaufzeit.

**Blocking im Detail:** Blocking an/aus (`enableBlocking`), temporär für X Minuten pausieren (Antwort enthält das Ende der Pause), Blocklisten-URLs und Update-Intervall verwalten, sofortiges Update erzwingen, Blockierungsart (NXDOMAIN, 0.0.0.0, eigene Adresse), eigene Block- und Allow-Einträge einzeln anlegen, löschen, importieren und exportieren. Ob sich eine temporäre Pause vorzeitig beenden lässt, steht nicht in der Doku; das müssen wir testen.

**Grafiken:** `dashboard/stats/get` liefert fertige Chart-Daten für LastHour, LastDay, LastWeek, LastMonth, LastYear oder einen eigenen Zeitraum:

- Zeitverlauf (`mainChartData`) mit Total, No Error, Server Failure, NX Domain, Refused, Authoritative, Recursive, Cached, Blocked, Dropped, Clients
- Antworttypen (Authoritative, Recursive, Cached, Blocked, Dropped)
- Query-Typen (A, AAAA, HTTPS …; standardmäßig Top 10)
- Protokolle (UDP, TCP, DoT, DoH, DoQ)
- Top-Clients (mit Hostname und Rate-Limit-Status), Top-Domains, Top-Blocked-Domains (bis 1000 Einträge über `getTop`)
- Summen: Queries, Blocked, Cached, Clients, Anzahl Zonen, Cache-Einträge, Anzahl blockierter Domains

Für Langzeitverläufe eignet sich zusätzlich der Prometheus-Endpunkt (`metrics/text`, laut Doku noch experimentell).

## Was die API nicht abdeckt

Diese Teile muss das IPAM selbst mitbringen:

- **Subnetze und VLANs als eigene Objekte.** Technitium kennt nur DHCP-Scopes und Reverse-Zonen. Netze ohne DHCP, VLAN-IDs, Standorte und Beschreibungen brauchen eine eigene Datenbank.
- **Statische IPs außerhalb von DHCP** (Server, Switches, Drucker). Die können wir nur als DNS-A-Einträge erkennen und müssen sie selbst als Adressen führen.
- **Belegung und freie Adressen.** Es gibt keinen Aufruf „nächste freie IP“. Berechnen lässt sich das aus Scope-Bereich, Ausschlüssen, Leases, Reservierungen und A-Einträgen.
- **Lease bearbeiten.** Dynamische Leases kann man nur löschen oder in Reservierungen umwandeln. „Bearbeiten“ einer Reservierung heißt entfernen und neu anlegen.
- **Geräteinventar und Historie.** Keine Geräteobjekte, kein Änderungsverlauf; Kommentare gibt es nur an DNS-Einträgen und Reservierungen.
- **Konflikterkennung** zwischen DNS, DHCP und statischen IPs. Muss das IPAM abgleichen; die Ping-Prüfung des DHCP-Scopes hilft nur bei der Vergabe.
- **Query-Logs** gibt es nur, wenn in Technitium eine Log-App installiert ist (z. B. „Query Logs (Sqlite)“).

## Vorgeschlagener Funktionsumfang IPAM

**Anzeige:**

- Netzübersicht: alle Subnetze und Scopes mit Auslastungsbalken (belegt, reserviert, dynamisch, frei, ausgeschlossen)
- IP-Raster pro Subnetz (z. B. /24 als 16×16-Kacheln), farbcodiert nach Status, mit Hostname, MAC und DNS-Name beim Hover
- Tabelle aller Adressen mit Suche und Filtern (IP, Hostname, MAC, Typ, Scope, Ablaufzeit)
- Abgleich: IP hat Lease, aber keinen DNS-Eintrag; A-Eintrag ohne PTR; Reservierung außerhalb des Scopes; doppelte IPs
- Zonen-Browser mit allen Einträgen, gruppiert nach Typ

**Bearbeiten:**

- DNS-Einträge aller Typen anlegen, ändern, deaktivieren und löschen, mit Formular je Typ und PTR-Automatik bei A/AAAA
- DHCP-Reservierungen anlegen, ändern und löschen; Lease mit einem Klick in eine Reservierung umwandeln
- Dynamische Leases freigeben (mit Warnung vor IP-Konflikten)
- Scopes anlegen und Optionen bearbeiten (Bereich, Gateway, DNS, Ausschlüsse)
- „Nächste freie IP“-Vorschlag beim Anlegen
- Kombinierte Aktion „Gerät anlegen“: Reservierung, A- und PTR-Eintrag in einem Schritt

**Dashboard-Widgets:**

- Blocking-Kachel: Status an/aus, Pause-Buttons (5, 15, 60 Minuten) mit Countdown, Anzahl blockierter Domains, Blocklisten jetzt aktualisieren
- Domain schnell blockieren oder erlauben
- Diagramme: Query-Verlauf (gestapelt nach Antworttyp, umschaltbar Stunde bis Jahr), Donut für Antwort- und Query-Typen, Top-Listen für Clients, Domains und Blocked Domains
- Kennzahlen: Queries, Blockquote in Prozent, Cache-Trefferquote, Clients, Health-Status
- Cluster-Ansicht pro Knoten oder aggregiert

**Architektur-Hinweise:**

- Alle Aufrufe über das eigene Backend leiten (Token bleibt serverseitig, keine CORS-Probleme), wie es Homepage und Mafl vormachen.
- Technitium bleibt die Quelle der Wahrheit für DNS und DHCP. Eigene Daten (Subnetze, VLANs, statische IPs, Notizen) liegen in der IPAM-Datenbank und werden über IP/MAC verknüpft.
- Schreibaktionen protokollieren (wer hat wann was geändert), weil Technitium selbst keinen Änderungsverlauf führt.
- Vor jedem Scope-`set` den aktuellen Stand frisch lesen, damit keine parallel angelegten Reservierungen verloren gehen.
- Später erweiterbar um weitere Quellen (z. B. UniFi, OPNsense, Proxmox), damit IPs automatisch Geräten und Racks (siehe Rackula) zugeordnet werden.

## Gerätegruppen (Adressbereiche mit Kategorie)

**Prüfung deines Vorschlags:** Die Idee passt gut und ist sauber umsetzbar, weil Gruppen nur im IPAM gespeichert werden und Technitium nie berühren. Zwei Punkte habe ich angepasst:

- **Schreibweise:** „10.10.1.50/23 bis 10.10.1.59/23“ mischt zwei Dinge. Das Präfix /23 beschreibt das Netz (hier 10.10.0.0/23, also 10.10.0.1 bis 10.10.1.254), nicht einzelne Adressen. Eine Gruppe ist deshalb besser ein **Bereich innerhalb eines Netzes**: Netz 10.10.0.0/23, Bereich 10.10.1.50–10.10.1.59. Alternativ als CIDR-Block, wenn er passt (z. B. 10.10.1.64/28).
- **Kategorie und Bereich trennen:** Eine Kategorie (z. B. „Schaltbare Steckdosen“) kann mehrere Bereiche haben, auch in verschiedenen Netzen oder VLANs. So lässt sich eine Gruppe später erweitern, ohne sie umzubauen.

**Datenmodell:**

| Objekt | Felder |
| --- | --- |
| Netz | Name, CIDR (z. B. 10.10.0.0/23), VLAN-ID, Gateway, Beschreibung, verknüpfter Technitium-Scope (optional), Reverse-Zone (optional) |
| Kategorie | Name, Icon, Farbe, Beschreibung, übergeordnete Kategorie (optional, z. B. „Smart Home › Steckdosen“), Standard-DNS-Zone und Namensschema für den Wizard |
| Bereich | Netz, Start-IP, End-IP, Kategorie, Sortierung |
| Adresse (abgeleitet) | IP, Status aus Technitium (Lease, Reservierung, DNS), Gruppe aus dem passenden Bereich, eigene Notiz und Tags |

**Regeln und Validierung:**

- Ein Bereich muss vollständig im Netz liegen; Netzadresse, Broadcast und Gateway werden markiert.
- Bereiche dürfen sich nicht überschneiden (sonst wäre eine IP zwei Gruppen zugeordnet). Das IPAM weist darauf hin und bietet Teilen oder Zusammenführen an.
- Hinweis, wenn ein Bereich mit dem dynamischen DHCP-Pool überlappt. Empfehlung: Gerätegruppen außerhalb des Pools anlegen oder als Ausschluss im Scope hinterlegen. Das IPAM schlägt das nur vor und schreibt nichts nach Technitium.
- „Fremde“ Geräte erkennen: eine IP im Bereich „Amazon Echo“, deren Hostname oder MAC-Hersteller (OUI) nicht passt, wird markiert.
- Volle Gruppen: Warnung ab einstellbarer Füllgrenze (z. B. 80 %).

**Darstellung (visuell ansprechend):**

- **Netzkarte:** pro Netz eine Karte mit gestapeltem Balken nach Kategorien (farbig) plus Anteile für DHCP-Pool, frei und reserviert. Klick führt ins Netz.
- **IP-Raster:** jede Adresse als Kachel (bei /23 zwei Blöcke mit 16×16). Kachelfarbe = Kategorie, Füllung = Status (belegt voll, reserviert schraffiert, frei hell, ausgeschlossen grau). Gruppenbereiche bekommen einen farbigen Rahmen mit Icon und Namen. Hover zeigt Hostname, MAC, Hersteller, DNS-Name und Lease-Ablauf.
- **Gruppenansicht:** Kacheln je Kategorie mit Icon, Belegung (z. B. 7 von 10), Liste der Geräte mit Online-Status (Ping) und Schnellaktionen.
- **Legende und Filter:** Kategorien ein- und ausblenden, nach Status filtern, Suche über alles.
- **Hell/Dunkel, frei wählbare Farben pro Kategorie**, Icons aus den bekannten Sets (MDI, Simple Icons, selfh.st).

## Wizard „Neue IP“

**Prüfung deines Vorschlags:** Der Ablauf ist schlüssig. Ergänzt habe ich: Auswahl des Netzes bei „ohne Gruppe“, die Art der Vergabe (Reservierung oder statisch), eine echte Belegtprüfung (nicht nur Technitium-Daten, auch Ping) und eine Zusammenfassung vor dem Speichern, weil der Wizard mehrere Änderungen in Technitium auslöst.

**Schritt 1 – Gruppe wählen**

- Kategorien als Kacheln mit Icon und freien Plätzen (z. B. „Schaltbare Steckdosen · 3 frei“). Volle Gruppen sind ausgegraut mit Hinweis.
- Option „Gerät ohne Gruppe“: Dann wird das Netz gewählt, Vorschläge kommen aus Adressen, die keiner Gruppe und nicht dem DHCP-Pool angehören.
- Hat eine Kategorie Bereiche in mehreren Netzen, wird zusätzlich das Netz abgefragt.

**Schritt 2 – Gerät beschreiben**

- Hostname (vorbelegt nach Namensschema der Kategorie, z. B. `steckdose-04`), MAC-Adresse (Pflicht für eine DHCP-Reservierung, Hersteller wird angezeigt), Notiz.
- Art der Vergabe: **DHCP-Reservierung** (Standard, braucht MAC und einen Technitium-Scope) oder **statisch** (nur im IPAM und optional DNS).
- Komfort: aus vorhandenen dynamischen Leases wählen. Dann sind MAC und Hostname schon ausgefüllt, und der Wizard wandelt die Lease am Ende um.
- Prüfung: MAC bereits reserviert? Dann Hinweis mit Link zur bestehenden Reservierung.

**Schritt 3 – IP vorschlagen und wählen**

- Großer Vorschlag oben: die erste freie Adresse im Bereich.
- Darunter eine Liste aller freien Adressen der Gruppe, alternativ als Mini-Raster zum Anklicken.
- „Frei“ heißt: keine Lease, keine Reservierung, kein A/PTR-Eintrag, nicht im IPAM als statisch erfasst, nicht ausgeschlossen, nicht Netz-, Broadcast- oder Gateway-Adresse. Zusätzlich ein kurzer Ping-Check, damit Geräte mit manuell gesetzter IP nicht übersehen werden.
- Eingabefeld „Eigene IP“ mit Live-Prüfung: liegt im Netz, liegt im Gruppenbereich (sonst Hinweis, aber erlaubt), Status der Adresse.
- **Belegte IP:** Es erscheint ein Bestätigungsdialog mit dem, was dort schon steht (z. B. „Reserviert für echo-02, MAC …, DNS echo-02.home“). Wahlmöglichkeiten: abbrechen, trotzdem verwenden (Konflikt bleibt markiert) oder bestehenden Eintrag ersetzen (alte Reservierung bzw. alte DNS-Einträge werden entfernt; das steht dann ausdrücklich in der Zusammenfassung).
- Kurz vor dem Speichern wird erneut geprüft, ob die IP noch frei ist, falls jemand parallel etwas vergeben hat.

**Schritt 4 – DNS (optional)**

- Schalter „DNS-Eintrag anlegen“ (Standard an, wenn die Kategorie eine Zone hat).
- Zone aus Technitium wählen (vorbelegt), Name (vorbelegt aus Hostname), daraus ergibt sich der FQDN, z. B. `steckdose-04.home.lan`.
- PTR automatisch mit anlegen (Standard an), TTL, Kommentar (vorbelegt mit Kategorie, z. B. „IPAM: Schaltbare Steckdosen“).
- Optional zusätzliche CNAMEs (Aliase).
- Prüfung: Name in der Zone schon vergeben? Dann Hinweis mit Optionen „anderer Name“ oder „überschreiben“.
- Hinweis, wenn im Scope `dnsUpdates` aktiv ist: Technitium legt für Leases dann selbst A/PTR an. Der Wizard empfiehlt in dem Fall, keinen eigenen Eintrag anzulegen oder ihn bewusst zu überschreiben.

**Schritt 5 – Zusammenfassung und Speichern**

- Übersicht aller geplanten Aktionen, z. B.: Reservierung 10.10.1.54 für MAC … im Scope „LAN“ anlegen; A-Eintrag `steckdose-04.home.lan` → 10.10.1.54 anlegen; PTR anlegen.
- Ausführung Schritt für Schritt mit Statusanzeige. Schlägt ein Schritt fehl, werden die schon ausgeführten rückgängig gemacht (z. B. Reservierung wieder entfernen) und die Fehlermeldung von Technitium angezeigt.
- Eintrag im Änderungsprotokoll des IPAM.
- Abschluss mit Buttons „Noch eine IP in dieser Gruppe“ und „Zum Gerät“.

**Technitium-Aufrufe des Wizards:**

| Schritt | Aufruf |
| --- | --- |
| Daten für Vorschläge | `dhcp/scopes/get`, `dhcp/leases/list`, `zones/records/get` (`listZone=true`) |
| Reservierung anlegen | `dhcp/scopes/addReservedLease` (oder `dhcp/leases/convertToReserved` bei vorhandener Lease) |
| Bestehende Reservierung ersetzen | `dhcp/scopes/removeReservedLease`, danach anlegen |
| DNS anlegen | `zones/records/add` mit `type=A`, `ptr=true`, `comments` |
| DNS ersetzen | `zones/records/add` mit `overwrite=true` oder `zones/records/update` |
| Rückgängig bei Fehler | `removeReservedLease`, `zones/records/delete` |

**Hinweis:** Eine neue Reservierung greift erst, wenn das Gerät seine Lease erneuert. Der Wizard zeigt das am Ende an, und man kann die alte dynamische Lease optional gleich löschen (`dhcp/leases/remove`), damit das Gerät beim nächsten Anfragen die reservierte IP bekommt.

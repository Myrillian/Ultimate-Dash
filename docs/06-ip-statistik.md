# Statistik je Netz

> Stand: 07.11.2026. Abgestimmt mit Matthias im Projekt-Thread (alle Zusatzkennzahlen, Verlauf und Summenzeile gewünscht).

## Ziel

Unter jedem Netz im IPAM steht eine kleine Statistik: wie viele Adressen es gibt, wie viele vergeben und frei sind, was online ist, was neu dazukam und wo es etwas aufzuräumen gibt.

## Kennzahlen

| Kennzahl | Definition | Quelle |
| --- | --- | --- |
| Gesamt | nutzbare Adressen (ohne Netz- und Broadcast-Adresse) | CIDR |
| Vergeben | Adressen mit mindestens einem Eintrag, aufgeteilt in Reservierung, Lease, statisch (DNS oder bestätigt) und nur entdeckt | Reservierungen, Leases, A-Einträge, Ping |
| Frei | Gesamt minus vergeben, aufgeteilt in „frei im DHCP-Pool“ und „frei außerhalb des Pools“ (für statische Adressen und Reservierungen) | DHCP-Scopes samt Ausschlüssen, nur aktive Scopes |
| DHCP-Pool belegt | vergebene Adressen im Pool durch Pool-Größe; ab 90 % als „fast voll“ markiert | DHCP-Scopes |
| Online | vergebene oder entdeckte Adressen, die beim letzten Ping antworten | Ping-Prüfung |
| Ohne Ping-Antwort | vergeben, aber kein Echo beim letzten Ping; manche Geräte blocken Ping | Ping-Prüfung |
| Neu entdeckt | antworten auf Ping, sind aber nirgends eingetragen | Ping-Prüfung |
| Neu seit 7 Tagen | erste Ping-Antwort liegt höchstens 7 Tage zurück | `ipam_hosts.first_seen_at` |
| Lange nicht gesehen | antwortet nicht, letzte Antwort älter als 30 Tage | `ipam_hosts.last_seen_at` |
| Lease läuft bald ab | dynamische Lease endet in weniger als 24 Stunden | DHCP-Leases |
| Ohne DNS-Eintrag | vergeben (nicht nur entdeckt), aber kein A-Eintrag | DNS |
| Ohne PTR | A-Eintrag vorhanden, eine Reverse-Zone deckt die Adresse ab, aber kein PTR | DNS (Reverse-Zonen) |
| Konflikte | eine Adresse mit mehreren MAC-Adressen | berechnet |

Ohne Ping-Prüfung (abgeschaltet oder Netz größer als /22) zeigen die Ping-Kennzahlen „nicht geprüft“ statt 0. Die Schwellen stehen als Konstanten in `packages/shared/src/ipam-stats.ts`.

## Darstellung

- **Übersicht:** Über den Karten eine Zeile „Alle Netze“ mit der Summe (ab zwei Netzen). Jede Netz-Karte zeigt unter dem Kategorie-Balken vier Kacheln (Vergeben, Online, Neu entdeckt, DHCP-Pool) und Hinweis-Chips, wenn es Konflikte, alte Geräte, ablaufende Leases oder DNS-Lücken gibt.
- **Netz im Detail:** Block „Statistik“ mit einem gestapelten Balken nach Art der Vergabe, allen Kennzahlen als Kacheln und dem Verlauf der letzten 30 Tage. Ein Klick auf eine Kachel filtert die Liste „Belegte Adressen“ auf genau diese Adressen (Filter `type`, `status` oder `flag` in der URL).

## Technik

- `ipamNetworkStats()` in `packages/shared` rechnet aus der Belegung; dieselben Merkmale (`ipamAddressFlags`) nutzt die Liste zum Filtern.
- Neue Felder je Adresse: `firstSeen`, `leaseExpires`, `ptr`. Die PTR-Einträge der Reverse-Zonen werden zusammen mit den übrigen Technitium-Daten geladen und 15 Sekunden zwischengespeichert.
- Der Aufwand wächst mit der Zahl der vergebenen Adressen, nicht mit der Netzgröße.
- Verlauf: Tabelle `ipam_network_history` (Netz, Tag, gesamt, vergeben, online), ein Eintrag je Netz und Tag, 90 Tage aufbewahrt. Geschrieben nach jeder Ping-Prüfung und stündlich; abrufbar über `GET /api/ipam/history?days=30`.

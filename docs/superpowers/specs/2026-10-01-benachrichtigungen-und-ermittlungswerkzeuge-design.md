# Benachrichtigungen und Ermittlungswerkzeuge – Design

Stand: 2026-10-01. Sechs voneinander weitgehend unabhängige Teilprojekte, in dieser Reihenfolge umgesetzt.

## A – Benachrichtigungen (Glocke + Inbox)

**Ziel:** Jeder Nutzer sieht in der App, was ihn betrifft – ohne Discord.

**Datenmodell**
- `Notification`: `kind`, `title`, `body?`, `href?`, Empfänger entweder `userId` (persönlich) **oder** `permission` (an alle mit diesem Recht), `actorId?`, `dedupeKey?` (unique, verhindert Doppelungen bei wiederholten Läufen), `createdAt`.
- `NotificationReceipt`: (`notificationId`, `userId`) unique, `readAt`. Gelesen-Status pro Nutzer – auch bei Rechte-Broadcasts.

**Sichtbarkeit:** `userId = ich` ODER `permission ∈ meine Rechte`, nie die eigenen Aktionen (`actorId ≠ ich`), nur die letzten 30 Tage.

**Auslöser (serverseitig, Fehler brechen die eigentliche Aktion nie ab)**
| Ereignis | Empfänger |
|---|---|
| Ermittler einer Akte zugewiesen | verknüpftes Konto des Agents |
| Fallführung gesetzt/geändert | verknüpftes Konto der neuen Fallführung |
| Rangänderung durchgeführt (Einzel + Liste) | verknüpftes Konto des Agents |
| Neue Rangänderungsliste angelegt | Broadcast `rank-changes:view` („Abstimmung offen“) |
| Probezeit endet in ≤ 3 Tagen | Konto des Agents + Ersteller der Probezeit (einmalig je Probezeit, `dedupeKey`) |
| Asservat übergeben (Teil F) | verknüpftes Konto des neuen Verwahrers |

Agent → Konto: `Agent.userId`, sonst `User.discordId = Agent.discordId`.
Probezeit-Erinnerungen laufen gedrosselt (max. alle 15 min je Prozess) beim Abruf der Inbox und in `/api/status-automation`.

**API:** `GET /api/notifications` → `{ items (max. 30), unreadCount }`; `POST /api/notifications/read` mit `{ ids }` oder `{ all: true }`.

**UI:** Glocke neben der Suche in `dashboard-shell`, Zähler-Badge, Popover-Liste mit „Alle gelesen“, Klick markiert gelesen und navigiert. Abruf über `useFetch` (30-s-Intervall + Live-Update-Signal).

## B – Aktionen in der Strg+K-Palette

Neue Aktionen (rechtegeprüft): „Ermittlung anlegen“, „Person anlegen“, „Fahrzeug anlegen“, „Sanktion erstellen“, „Abmeldung erfassen“ sowie kontextbezogen bei Agent-Treffern „Sanktion für ‹Agent›“ und „Personalakte von ‹Agent›“. Zielseiten öffnen den Anlage-Dialog über Query-Parameter (`?new=1`, `?agent=<id>`); die Parameter werden nach dem Öffnen aus der URL entfernt.

## C – Treffer über Fälle hinweg

- `GET /api/investigations/cross-hits?name=…&plate=…` liefert passende Personen/Fahrzeuge mit der Zahl (für den Nutzer sichtbarer) Akten, in denen sie vorkommen.
- Personen- und Fahrzeugformular zeigen beim Anlegen einen Hinweis „Bereits erfasst: … – in N Ermittlungen“.
- In der Akte zeigt jede beteiligte Person / jedes Fahrzeug „auch in N weiteren Akten“ (aus dem Detail-Endpunkt, Verschlusssachen gefiltert).

## D – Fall-Zeitstrahl

Neuer Reiter „Zeitstrahl“ in der Akte. Rein clientseitig aus vorhandenen Daten: Chronologie-Einträge (`occurredAt`), Clips (`recordedAt ?? createdAt`), Asservate (`seizedAt`), Bilder (`createdAt`), Beweiskettenereignisse (F). Vertikale Achse, nach Tagen gruppiert, Filter-Chips je Typ.

## E – Verknüpfungsgraph

- `GET /api/investigations/graph?focus=<kind>:<id>&depth=1|2` liefert Knoten (Akten, Personen, Fahrzeuge) und Kanten (Akte–Person mit Rolle, Akte–Fahrzeug, Person–Person, Akte–Akte, Halter–Fahrzeug). Breitensuche ab Fokus, Verschlusssachen gefiltert, max. 150 Knoten.
- Seite `/investigations/graph` mit eigener kleiner Kräftesimulation in SVG (keine neue Abhängigkeit), Zoom/Pan, Knoten ziehbar, Klick = Fokus wechseln, Doppelklick = Akte öffnen. Einstieg aus Akte und Personenregister.

## F – Beweiskette (Chain of Custody)

- `EvidenceCustodyEvent`: `action` (CREATED, VIEWED, UPDATED, STATUS_CHANGED, TRANSFERRED, DELETED), `actorId`, `actorName` (Snapshot), `fromHolder`, `toHolder`, `location`, `note`, `itemNumber`/`investigationId` als Snapshot, `prevHash`, `hash` (SHA-256 über Vorgänger-Hash + Inhalt). `evidenceId` mit `onDelete: SetNull`, damit die Kette die Löschung überlebt; Kettenschlüssel ist `chainKey` (= ursprüngliche Asservat-ID), weil Asservatennummern nach einer Löschung neu vergeben werden können.
- Anhängen nur in einer Transaktion mit `SELECT … FOR UPDATE` auf das Asservat (keine Gabelungen). Die Prüfung ordnet die Kette entlang `prevHash → hash` (nicht nach Zeitstempel) und meldet veränderte, fehlende, eingeschobene oder gegabelte Einträge. Grenze: wer Schreibzugriff auf die Datenbank hat, kann die gesamte Kette neu berechnen – erkannt wird Manipulation einzelner Einträge, nicht ein vollständiger Neuaufbau.
- Keine Bearbeitungs- oder Lösch-API für Ereignisse. Erstellen/Ändern/Löschen eines Asservats schreibt automatisch Ereignisse; „Übergabe erfassen“ schreibt TRANSFERRED und aktualisiert den Verwahrort.
- „Angesehen“: Öffnen des Beweisketten-Dialogs protokolliert VIEWED (max. 1× je Nutzer und 10 min).
- `GET /api/investigations/evidence/[id]/custody` liefert Kette + Integritätsprüfung.
- Druckansicht `/investigations/evidence/[id]/custody` (A4, hell) → „Als PDF speichern“ über den Druckdialog, wie bei der Personalakte.

## Datenbank

Additiver Patch `prisma/patches/2026-10-01-notifications-custody.sql` (neue Tabellen, keine Änderung bestehender Spalten) bzw. `npm run db:push`.

## Tests

`node:test` mit `tsx` wie bestehende Tests: reine Logik (Sichtbarkeit/Dedupe der Benachrichtigungen, Hash-Kette inkl. Manipulationserkennung, Graph-Aufbau/Begrenzung, Zeitstrahl-Zusammenführung, Palette-Aktionen nach Rechten). Danach `tsc`, `eslint`, `next build`.

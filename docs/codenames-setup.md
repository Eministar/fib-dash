# Decknamen-System: Einrichtung und Prüfung

Implementiert nach `docs/superpowers/specs/2026-09-08-decknamen-system-design.md`.
Es gelten die Entwurfsannahmen: intern sichtbare Zuordnung, sofortige Wiederverwendung
freier Namen, maximal ein aktueller Deckname pro Agent. Gesperrte Namen werden bei
Sperrung freigegeben und können erst nach Entsperrung erneut zugewiesen werden.

## Datenbank und Katalog

Das Repository verwendet bisher `prisma db push` und hat keine Migrationshistorie.
Der additive SQL-Patch `prisma/patches/2026-09-08-codenames.sql` wurde aus dem
Schema-Diff generiert. Er erstellt ausschließlich die zwei neuen Tabellen samt
Indizes und Fremdschlüsseln. Er ist einmalig auf eine bestehende Installation ohne
diese Tabellen anzuwenden; nicht zusätzlich zu einem bereits erfolgten Schema-Push.

Vor der Inbetriebnahme mit der vorgesehenen Datenbank:

```sh
npm run db:backup
npx prisma db execute --file prisma/patches/2026-09-08-codenames.sql
npm run db:generate
npm run db:seed-codenames
```

Alternativ lässt sich das Schema im bisherigen Projektablauf mit `npm run db:push`
abgleichen. Vorher den gesamten Schema-Diff der jeweiligen Installation prüfen.
Für eine neue Datenbank zuerst die bestehende Projektinitialisierung durchführen.

`prisma/data/codenames.json` enthält 2.100 eindeutige **Namensvorschläge**.
Alle Namen bestehen aus genau einem Wort mit höchstens acht Buchstaben;
1.499 davon haben höchstens sechs Buchstaben. Beispiele: Ghost, Flint, Viper,
Onyx, Lynx, Rook und Nyx. Die Liste enthält eigenständige Namen aus Natur,
Mythologie, Astronomie und weiteren Themen; keine automatisch erzeugten
Adjektiv-Kombinationen. Die Liste ist eigens zusammengestellt, keine extern
bezogene oder redaktionell freigegebene Sammlung.
Vor einem produktiven Import inhaltlich prüfen. Einzelne Namen dürfen ergänzt oder
entfernt werden. Ein erneuter Seed überspringt bestehende Namen und verändert weder
deren Sperren noch Zuweisungen oder Historie. Auch ein bestehendes Präfix bleibt erhalten.
Bereits importierte Namen, die in einer überarbeiteten Liste fehlen, werden durch
den Seed nicht gelöscht. Die Listenänderung betrifft zunächst die Datendatei.

## Berechtigungen und Discord

- In den Benutzergruppen `codenames:view` bzw. `codenames:manage` vergeben.
  Verwaltung impliziert Lesezugriff und `agents:view`.
- Unter Einstellungen das Decknamen-Präfix setzen (Standard `Agent`, leer ist erlaubt).
- Unter Discord-Konfiguration den Decknamen-Board-Channel wählen. Alternativ
  `DISCORD_CODENAME_BOARD_CHANNEL_ID` setzen; die Umgebungsvariable hat Vorrang.
- Der vorhandene Bot benötigt im Zielchannel Zugriff zum Lesen/Senden/Bearbeiten
  seiner Nachrichten. Das Dashboard veröffentlicht keine Meldungen ohne Channel-Konfiguration.
- Über „Board aktualisieren“ auf `/codenames` einmal synchronisieren
  (`settings:manage`). Automatische Änderungen laufen entkoppelt vom API-Request.

Das Board verwendet höchstens 30 Zeilen pro Nachricht und teilt zusätzlich nach
Zeichenbudget auf. Vorhandene IDs werden bearbeitet; nur tatsächlich gelöschte
Nachrichten werden ersetzt. Nach jedem Erstellen/Löschen wird der ID-Zwischenstand
gespeichert. Bei Channel-Wechsel werden die alten Board-Nachrichten entfernt.
Automatische und manuelle Läufe sind pro Node-Prozess serialisiert. Der bestehende
Scheduler startet zusätzlich einen Abgleich alle fünf Minuten, auch wenn periodischer
Rollensync deaktiviert ist. Für einen Betrieb mit mehreren Node-Instanzen ist ein
einzelner Board-Worker bzw. eine verteilte Synchronisationssperre erforderlich.

## API

Alle Routen verwenden die vorhandene `{ success, data }`-Antwortstruktur bzw.
`{ success: false, error }`. Katalog, Belegung und Historien sind paginiert.
`page` beginnt bei 1; `pageSize` ist standardmäßig 30 und auf 100 begrenzt.
Katalogfilter: `search`, `category`, `status=free|assigned|retired`.
Listen liefern `{ items, total, page, pageSize }`; Katalog zusätzlich `categories`
und `prefix`, Belegung zusätzlich `prefix`, Agent-Historie zusätzlich `current` und `prefix`.

- `POST /api/codenames`: `{ name, category? }`
- `PATCH /api/codenames/[id]`: `{ name?, category?, retired?, retiredReason? }`
- `DELETE /api/codenames/[id]`: nur ohne Träger und ohne Zuweisungshistorie
- `POST /api/codenames/[id]/assign`: `{ agentId, note?, force? }`
- `POST /api/codenames/[id]/release`: `{ retire?, note? }`
- `GET /api/codenames`, `/api/codenames/assignments`, `/api/codenames/[id]/history`
- `GET /api/agents/[id]/codename`
- `POST /api/codenames/board/sync`

Konflikte liefern 409, unbekannte Datensätze 404, ungültige Eingaben 400.
Zuweisungen und Audit-Einträge laufen in derselben Serializable-Transaktion.
Deadlocks werden begrenzt wiederholt. Die beiden Kündigungswege teilen den
Freigabe-Hook mit der Statusänderung in einer Transaktion. Freigaben hängen ihre
Notiz an die ursprüngliche Zuweisungsnotiz an.

## Verifikation

```sh
npm run test:codenames
npm run build
```

Die Tests prüfen die produktiven Transaktionsfunktionen mit einem kleinen
Transaktionsdouble sowie Rendering, Nachrichtenabgleich, Validierung und Seed-Daten.
Sie ersetzen keinen MariaDB-Integrationstest der Sperren und des Unique-Index.
SQL-Patch, Seed und tatsächliches Discord-Senden wurden bei der Implementierung
nicht gegen die konfigurierte Datenbank bzw. den Verbund ausgeführt.

Nach Bereitstellung auf einer Testinstallation: zweimal seeden, parallel denselben
Namen sowie zwei Namen an denselben Agent vergeben, Trägerwechsel erzwingen,
Notizen/Historie kontrollieren, beide Kündigungswege testen und ein Board mit mehr
als 30 Belegungen anschließend verkleinern. Bei einem simulierten Discord-Ausfall
muss die Zuweisung trotzdem erfolgreich bleiben; der nächste Sync holt das Board nach.

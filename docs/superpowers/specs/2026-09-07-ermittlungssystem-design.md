# Einsatzakten- und Ermittlungssystem mit Bodycam-Katalog

Stand: 2026-09-07

## Ziel

Ermittlungsakten für Einsätze: ein Fall (`Investigation`) bündelt eine
Chronologie von Einsätzen und Ermittlungsschritten (`InvestigationEntry`),
beteiligte Personen aus einem fallübergreifenden Register (`Person`) und
Bodycam-Clips (`BodycamClip`). Clips werden als echte Videodateien auf den
Server hochgeladen und über eine geschützte Streaming-Route abgespielt.

Nicht Teil dieses Specs: das Decknamen-System (eigener Spec).

## Datenmodell

| Modell | Zweck |
| --- | --- |
| `Investigation` | Die Akte. Aktenzeichen `ERM-0001`, Status, Priorität, Verschlusssache-Flag, Fallführung, Zusammenfassung. |
| `InvestigationAssignee` | Weitere zugewiesene Ermittler (**Agents**). Dürfen auch Verschlusssachen sehen. |
| `InvestigationEntry` | Ein Einsatz oder Ermittlungsschritt in der Chronologie. Art, Zeitpunkt, Ort, Hergang, Beteiligten-Snapshot. |
| `Person` | Fallübergreifendes Personenregister. `PER-0001`, Name, Alias, Kennung, Flags `wanted`/`dangerous`. |
| `InvestigationPerson` | Verknüpfung Akte ↔ Person mit Rolle (Verdächtiger, Zeuge, Opfer, …). |
| `BodycamClip` | Videodatei + Metadaten. Hängt an der Akte und optional zusätzlich an einem Eintrag. |
| `Evidence` | Asservat mit Nummer `ASV-0001`, Art, Status, Fundort, Verwahrort, sicherstellendem Agent. |
| `Vehicle` / `InvestigationVehicle` | Fallübergreifendes Fahrzeugregister `FZG-0001` mit Halter aus dem Personenregister; Verknüpfung zur Akte. |
| `PersonLink` | Gerichtete Verbindung zwischen zwei Personen (Familie, Umfeld, Arbeitgeber, Mitglied bei …). |
| `InvestigationLink` | Querverweis zwischen zwei Akten. |

Enums: `InvestigationStatus`, `InvestigationPriority`, `InvestigationEntryKind`,
`InvestigationPersonRole`, `EvidenceKind`, `EvidenceStatus`, `PersonLinkType`.

Aktenzeichen über `nextSequenceNumber()` aus `src/lib/sequence-numbers.ts`
(bestehendes Muster), Präfixe `ERM-`, `PER-`, `ASV-` und `FZG-`.

Verbindungen (`PersonLink`, `InvestigationLink`) werden nur in eine Richtung
gespeichert; beide Seiten laden `linksFrom` und `linksTo`. So kann keine
halbseitige Verbindung entstehen.

## Zugriffsschutz

Neue Permissions: `investigations:view`, `investigations:manage`,
`investigations:classified`, `investigations:delete`.

Eine Akte mit `classified = true` ist nur sichtbar für:
Ersteller, Fallführung, zugewiesene Ermittler, oder Inhaber von
`investigations:classified`.

Zugewiesen werden **Agents**, angemeldet sind **Benutzerkonten** — die Brücke ist
wie überall im Dashboard die Discord-ID. Ein Agent ohne Discord-Verknüpfung kann
daher zwar zugewiesen werden (die Akte dokumentiert, wer ermittelt), erhält
darüber aber keinen Zugriff auf eine Verschlusssache. Sowohl der Agent-Picker als
auch die Zuweisungsliste weisen darauf hin.

Diese Prüfung (`canAccessInvestigation` in `src/lib/investigations.ts`) gilt
identisch für Akte, Einträge, Clip-Metadaten **und die Video-Streaming-Route** —
sonst wären Clips vertraulicher Akten über die URL abgreifbar.

## Clip-Upload und Wiedergabe

- Echter Datei-Upload, kein externer Link, kein Transcoding.
- Limit `CLIP_MAX_BYTES`, Default 500 MB, unabhängig vom bestehenden
  `UPLOAD_MAX_BYTES` (10 MB) für Dokumente.
- Erlaubte Typen: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`
  (`.mp4`, `.webm`, `.mov`, `.mkv`).
- Ablage in `CLIP_DIR` (Default `<UPLOAD_DIR>/clips`), Dateiname `<uuid><ext>`,
  Pfad-Traversal-Schutz analog `src/lib/uploads.ts`.
- Der Request-Body wird als Stream auf Platte geschrieben, nicht komplett in den
  RAM geladen. Bei Abbruch oder Limit-Überschreitung wird die Teildatei gelöscht.
- Wiedergabe über `GET /api/investigations/clips/[id]/stream` mit
  HTTP-Range-Support (Vorspulen) und `Content-Type` aus den Metadaten.
- Löschen eines Clips entfernt Datei und Datensatz.

## API

```
GET    /api/investigations                 Liste (Filter: status, priority, search, personId)
POST   /api/investigations                 Akte anlegen
GET    /api/investigations/[id]            Akte mit Einträgen, Personen, Clips
PATCH  /api/investigations/[id]            Akte ändern
DELETE /api/investigations/[id]            Akte löschen (inkl. Clip-Dateien)

POST   /api/investigations/[id]/entries    Eintrag anlegen
PATCH  /api/investigations/entries/[id]    Eintrag ändern
DELETE /api/investigations/entries/[id]    Eintrag löschen

POST   /api/investigations/[id]/persons    Person verknüpfen
DELETE /api/investigations/persons/[id]    Verknüpfung lösen

POST   /api/investigations/[id]/assignees  Einzelnen Ermittler zuweisen
DELETE /api/investigations/assignees/[id]  Zuweisung aufheben

POST   /api/investigations/[id]/evidence   Asservat erfassen
PATCH  /api/investigations/evidence/[id]   Asservat ändern (u. a. Status)
DELETE /api/investigations/evidence/[id]   Asservat löschen

POST   /api/investigations/[id]/vehicles   Fahrzeug verknüpfen
DELETE /api/investigations/vehicles/[id]   Verknüpfung lösen

POST   /api/investigations/[id]/links      Akte querverweisen
DELETE /api/investigations/links/[id]      Querverweis lösen

GET    /api/vehicles                       Fahrzeugregister
POST   /api/vehicles                       Fahrzeug anlegen
GET    /api/vehicles/[id]                  Fahrzeug + verknüpfte Akten
PATCH  /api/vehicles/[id]                  Fahrzeug ändern
DELETE /api/vehicles/[id]                  Fahrzeug löschen

POST   /api/persons/[id]/links             Personen verbinden
DELETE /api/persons/links/[id]             Verbindung lösen

GET    /api/investigations/clips           Bodycam-Katalog (alle sichtbaren Clips)
POST   /api/investigations/clips           Upload (roher Body + x-clip-meta)
PATCH  /api/investigations/clips/[id]      Metadaten ändern
DELETE /api/investigations/clips/[id]      Clip löschen
GET    /api/investigations/clips/[id]/stream   Video mit Range-Support

GET    /api/persons                        Personenregister
POST   /api/persons                        Person anlegen
GET    /api/persons/[id]                   Person + verknüpfte Akten
PATCH  /api/persons/[id]                   Person ändern
DELETE /api/persons/[id]                   Person löschen
```

Fehlerbehandlung wie im Bestand: `requirePermission`, `try/catch` auf
`Unauthorized`/`Forbidden`, Antworten über `src/lib/api-response.ts`.

## UI

- `/investigations` — Aktenliste mit Filter (Status, Priorität, Suche), Anlegen-Dialog.
- `/investigations/[id]` — Aktendetail: Kopf mit Status/Priorität/Fallführung,
  zugewiesene Ermittler, Personenliste, Chronologie der Einträge, Clip-Panel mit
  Upload und Player, Asservate, Fahrzeuge und Querverweise.
  Beim Anlegen lassen sich Ermittler direkt über einen durchsuchbaren
  Agent-Picker mitgeben; später fügt jeder mit `investigations:manage` einzeln
  hinzu — bewusst als eigener Endpunkt, damit zwei gleichzeitige Zuweisungen
  sich nicht gegenseitig überschreiben.
- `/investigations/clips` — Bodycam-Katalog: alle sichtbaren Clips als Raster,
  Filter nach Akte, aufnehmendem Agent, Datum und Tag; Player im Dialog.
- `/investigations/persons` — Personenregister mit Detailseite, Beziehungsnetz
  und den Fahrzeugen der Person.
- `/investigations/vehicles` — Fahrzeugregister mit Fahrzeugakte.
- Sidebar-Eintrag „Ermittlungen" unter `investigations:view`.

Komponenten unter `src/components/investigations/`, jede Datei mit einer klaren
Aufgabe (Liste, Detail, Zuweisungen, Asservate, Fahrzeuge, Querverweise,
Clip-Upload, Clip-Player, Personen- und Fahrzeugregister, Agent-Picker).
Die Schreibvorgänge der Panels laufen über `useInvestigationMutation`, damit
absenden/melden/neu laden nicht in jedem Panel neu geschrieben wird.

## Discord

Bei Anlage einer Akte, Statuswechsel und neuem Clip geht eine Nachricht in einen
konfigurierbaren Channel (`investigationsChannelId` in der Discord-Config).
**Verschlusssachen werden nie gepostet.** Umgesetzt über die bestehende
Bot-Integration in `src/lib/discord-integration.ts`.

## Audit

Alle schreibenden Aktionen erzeugen einen `AuditLog`-Eintrag
(`INVESTIGATION_CREATED`, `INVESTIGATION_UPDATED`, `INVESTIGATION_DELETED`,
`INVESTIGATION_ENTRY_*`, `CLIP_UPLOADED`, `CLIP_DELETED`, `PERSON_*`).

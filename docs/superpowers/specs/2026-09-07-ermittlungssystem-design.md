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
| `InvestigationAssignee` | Weitere zugewiesene Ermittler (User). Dürfen auch Verschlusssachen sehen. |
| `InvestigationEntry` | Ein Einsatz oder Ermittlungsschritt in der Chronologie. Art, Zeitpunkt, Ort, Hergang, Beteiligten-Snapshot. |
| `Person` | Fallübergreifendes Personenregister. `PER-0001`, Name, Alias, Kennung, Flags `wanted`/`dangerous`. |
| `InvestigationPerson` | Verknüpfung Akte ↔ Person mit Rolle (Verdächtiger, Zeuge, Opfer, …). |
| `BodycamClip` | Videodatei + Metadaten. Hängt an der Akte und optional zusätzlich an einem Eintrag. |

Enums: `InvestigationStatus`, `InvestigationPriority`, `InvestigationEntryKind`,
`InvestigationPersonRole`.

Aktenzeichen über `nextSequenceNumber()` aus `src/lib/sequence-numbers.ts`
(bestehendes Muster), Präfixe `ERM-` und `PER-`.

## Zugriffsschutz

Neue Permissions: `investigations:view`, `investigations:manage`,
`investigations:classified`, `investigations:delete`.

Eine Akte mit `classified = true` ist nur sichtbar für:
Ersteller, Fallführung (`leadAgent` über den verknüpften User), zugewiesene
Ermittler, oder Inhaber von `investigations:classified`.

Diese Prüfung (`canAccessInvestigation` in `src/lib/investigations.ts`) gilt
identisch für Akte, Einträge, Clip-Metadaten **und die Video-Streaming-Route** —
sonst wären Clips vertraulicher Akten über die URL abgreifbar.

## Clip-Upload und Wiedergabe

- Echter Datei-Upload, kein externer Link, kein Transcoding.
- Limit `CLIP_MAX_BYTES`, Default 500 MB, unabhängig vom bestehenden
  `UPLOAD_MAX_BYTES` (10 MB) für Dokumente.
- Erlaubte Typen: `video/mp4`, `video/webm`, `video/quicktime` (`.mp4`, `.webm`, `.mov`).
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

GET    /api/investigations/clips           Bodycam-Katalog (alle sichtbaren Clips)
POST   /api/investigations/clips           Upload (multipart)
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
  Chronologie der Einträge, Personenliste, Clip-Panel mit Upload und Player.
- `/investigations/clips` — Bodycam-Katalog: alle sichtbaren Clips als Raster,
  Filter nach Akte, aufnehmendem Agent, Datum und Tag; Player im Dialog.
- `/investigations/persons` — Personenregister mit Detailseite.
- Sidebar-Eintrag „Ermittlungen" unter `investigations:view`.

Komponenten unter `src/components/investigations/`, jede Datei mit einer klaren
Aufgabe (Liste, Detail, Chronologie, Clip-Upload, Clip-Player, Personenregister).

## Discord

Bei Anlage einer Akte, Statuswechsel und neuem Clip geht eine Nachricht in einen
konfigurierbaren Channel (`investigationsChannelId` in der Discord-Config).
**Verschlusssachen werden nie gepostet.** Umgesetzt über die bestehende
Bot-Integration in `src/lib/discord-integration.ts`.

## Audit

Alle schreibenden Aktionen erzeugen einen `AuditLog`-Eintrag
(`INVESTIGATION_CREATED`, `INVESTIGATION_UPDATED`, `INVESTIGATION_DELETED`,
`INVESTIGATION_ENTRY_*`, `CLIP_UPLOADED`, `CLIP_DELETED`, `PERSON_*`).

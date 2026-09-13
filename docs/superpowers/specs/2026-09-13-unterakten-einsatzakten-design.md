# Unterakten zu Einsatzakten zusammenführen

Datum: 2026-09-13

## Problem

Das Ermittlungssystem führt zwei Begriffe für dieselbe Sache:

- **Unterakte** — ein `Dossier` mit `kind = 'FILE'` (`src/lib/dossiers.ts:1`), eingehängt
  unter einer Dauerakte über `Dossier.parentId`.
- **Einsatzakte** — ein `Investigation`-Datensatz mit Aktenzeichen `ERM-XXXX`,
  eingehängt über die n:m-Relation `DossierInvestigations`.

Beide beschreiben denselben Vorgang: einen Einsatz, der zu einer Dauerakte gehört.
Die Oberfläche zeigt sie in getrennten Reitern (`dossiers-workspace.tsx:101`), der
Kommentar dort behauptet sogar ausdrücklich, es seien „verschiedene Dinge". Das ist
für die Nutzer nicht unterscheidbar und führt dazu, dass gleichartige Vorgänge mal
hier, mal dort landen.

Dazu kommen zwei kleinere Baustellen, die am selben Bereich hängen:

- Fahrzeugakten lassen sich in der Oberfläche nicht bearbeiten, obwohl die API es
  kann.
- In der Linkfreigabe erscheint unter „Einzelakten / Einsatzakten" keine Auswahl.

## Ziel

Nach der Umsetzung gibt es nur noch **einen** Begriff für einen Einsatz: die
Einsatzakte. Der Datenbestand enthält keine `FILE`-Dossiers mehr, die Oberfläche
bietet die Kategorie nicht mehr an, Fahrzeugakten sind editierbar, und die
Linkfreigabe listet Einsatzakten.

## Nicht-Ziele

- Der Dossier-Baum (`parentId` / `children`) bleibt bestehen. Eine Familienakte darf
  weiterhin ein Anwesen unter sich führen — nur die Kategorie „Unterakte" fällt weg.
- Kein Zusammenlegen der Tabellen `Dossier` und `Investigation`.
- Keine Änderung am Sichtbarkeitsmodell für Verschlusssachen.

## Teil 1 — Datenmigration

### Schema

Keine Schemaänderung nötig. `Dossier.kind` ist ein freies `VARCHAR(20)`
(`prisma/schema.prisma:2114`); `FILE` verschwindet ausschließlich aus den
Zod-Enums und der Oberfläche. Damit entfällt auch ein SQL-Patch unter
`prisma/patches/`.

### Skript

`scripts/migrate-unterakten-to-einsatzakten.ts`, eingehängt als
`npm run db:migrate-unterakten`.

- **Standardlauf ist ein Dry-Run.** Er gibt einen Report aus und schreibt nichts.
- Erst `npm run db:migrate-unterakten -- --apply` schreibt, und ruft davor
  verpflichtend `npm run db:backup` auf.
- Der Schreiblauf läuft in einer Transaktion mit
  `Prisma.TransactionIsolationLevel.Serializable`, wie `saveDossier`
  (`src/lib/dossiers-server.ts:100`).
- Nach einem erfolgreichen Lauf existieren keine `FILE`-Dossiers mehr, ein zweiter
  Lauf ist daher ein No-op. Das Skript ist dadurch gefahrlos wiederholbar.

### Feldabbildung

| Unterakte (`Dossier`, kind=FILE) | Einsatzakte (`Investigation`) |
| --- | --- |
| `title` | `title` |
| `description` | `summary` |
| `address` | als eigene Zeile `Adresse: <wert>` an `summary` angehängt |
| `photoId` | ein Eintrag in `Investigation.photos` (n:m, `InvestigationPhotos`) |
| `createdById` | `createdById` |
| `createdAt` / `updatedAt` | unverändert übernommen |
| — | `caseNumber` aus `nextInvestigationCaseNumber()` (`ERM-XXXX`) |
| — | `status: OPEN`, `priority: NORMAL`, `classified: false` |

`Investigation` hat kein Adressfeld. Die Adresse in `summary` zu schreiben ist
verlustfrei genug und bleibt durchsuchbar; ein neues Feld nur für Altdaten wäre
Ballast.

### Relationen

| Unterakte | Ziel |
| --- | --- |
| `persons` | `InvestigationPerson` mit `role: OTHER` |
| `vehicles` | `InvestigationVehicle` |
| `mapSpots` | `Investigation.mapSpots` |
| `clips` | wandern an die Anker-Dauerakte |
| `investigations` (bereits verknüpfte Fälle) | wandern an die Anker-Dauerakte |

`role: OTHER` statt `SUSPECT`: die alte Unterakte kennt keine Rolle, und
`SUSPECT` (der Prisma-Default) würde eine Tatverdacht-Behauptung erfinden, die nie
jemand erfasst hat.

Clips lassen sich nicht umhängen: `BodycamClip.investigationId` ist ein
Pflichtfeld (`prisma/schema.prisma:1844`), jeder Clip gehört also bereits einer
eigenen Einsatzakte. `Dossier.clips` ist nur eine zusätzliche Kuratierung, die an
die Anker-Dauerakte weitergereicht wird.

### Anker und Baum

**Anker** einer FILE-Akte = die erste Akte auf dem `parentId`-Pfad nach oben, deren
`kind` nicht `FILE` ist.

- Die neue Einsatzakte wird per `DossierInvestigations` am Anker eingehängt.
- Hat eine FILE-Akte keinen Anker (FILE auf Wurzelebene), entsteht eine
  freistehende Einsatzakte ohne Dauerakte.
- Nicht-FILE-Kinder einer FILE-Akte werden auf denselben Anker umgehängt; hat die
  FILE-Akte keinen Anker, werden sie zu Wurzelakten (`parentId: null`).
- Alles wird flach: die frühere Verschachtelung unter Unterakten geht als Struktur
  verloren. Das ist die bewusst getroffene Entscheidung.

Verarbeitungsreihenfolge: erst alle Anker über den vollständigen Baum bestimmen,
dann umhängen, dann konvertieren, zuletzt die FILE-Dossiers löschen. `Dossier.parent`
steht auf `onDelete: Restrict` — ohne vorheriges Umhängen schlägt das Löschen fehl.

### Freigabelinks nachziehen

`RecordShareItem` hat **keinen** Fremdschlüssel auf `Dossier`
(`prisma/schema.prisma:2238`) — es speichert nur `kind` + `recordId` als Text.
Beim Löschen einer Unterakte bliebe ein bestehender Freigabelink also mit einem
Eintrag zurück, der ins Leere zeigt; die Leseansicht würde dort `403` werfen
(`src/lib/record-shares.ts:96`).

Das Skript schreibt deshalb jeden `RecordShareItem` mit
`kind = 'DOSSIER'` und einer migrierten `recordId` um auf:

- `kind: 'CASE'`
- `recordId`: die ID der neuen Einsatzakte
- `title`: `<caseNumber> · <title>` — dasselbe Format wie `validateShareItems`

Kollidiert das Ergebnis mit dem Unique-Index `[shareId, kind, recordId]` — weil
dieselbe Freigabe die Ziel-Einsatzakte schon enthält —, wird der alte Eintrag
stattdessen gelöscht.

### Report

Der Report (Dry-Run wie Schreiblauf) listet je Umwandlung die alte Dossier-ID, den
Titel, die neue Investigation-ID und das vergebene Aktenzeichen, dazu die Zahl der
umgehängten Kinder, Clips, Fallverknüpfungen und angepassten Freigabe-Einträge.
Ohne diese Zuordnung lässt sich ein Fehllauf im Backup nicht zurückverfolgen.

## Teil 2 — `FILE` aus dem Code entfernen

- `src/lib/dossiers.ts:1` — `FILE` aus `DOSSIER_KINDS`.
- `src/lib/dossiers-server.ts:12` — `FILE` aus `dossierSchema.kind`.
- `src/app/api/investigations/dossiers/route.ts:11` — `FILE` aus dem Query-Enum.
- `src/components/investigations/dossiers-workspace.tsx`:
  - `DOSSIER_KIND_HINTS.FILE` entfällt (Zeile 324).
  - Vorbelegung beim Anlegen unter einer Elternakte wird `COLLECTION` statt `FILE`
    (Zeile 330).
  - Reiter „Unterakten" heißt **„Untergeordnete Akten"**, Knopf „Unterakte anlegen"
    heißt **„Untergeordnete Akte anlegen"**, Kachel-Fakt `… Unterakten` heißt
    **`… untergeordnete Akten`**.
  - Der Kommentar bei Zeile 84 („verschiedene Dinge") wird korrigiert.
- Fehlertexte in `dossiers-server.ts:46,47` und
  `api/investigations/dossiers/[id]/route.ts:34` sprechen von „untergeordneten
  Akten" statt „Unterakten".
- `src/lib/record-share-validation.ts:3` — Label `DOSSIER` wird von
  „Dauerakten / Unterakten" zu **„Dauerakten"**.
- `src/components/investigations/share-manager.tsx:38,71` — Hinweistexte auf die
  neue Begriffswelt.

Die Umbenennung des Reiters statt seiner Entfernung ist Absicht: die Baumstruktur
bleibt ja bestehen (Nicht-Ziele), nur der Begriff „Unterakte" verschwindet.

## Teil 3 — Fahrzeugakten bearbeiten

`PATCH /api/vehicles/[id]` beherrscht bereits Kennzeichen, Modell, Farbe, Halter,
Notizen, `stolen` und `wanted`. Die Oberfläche
(`src/components/investigations/vehicle-register.tsx:203`) erlaubt davon nur das
Foto.

Das Detail-Modal bekommt einen Bearbeiten-Modus mit genau denselben Feldern wie das
Anlege-Modal. Beide Modale teilen sich dazu ein gemeinsames Formular-Fragment, damit
die Felder nicht an zwei Stellen gepflegt werden müssen — `vehicle-register.tsx` ist
mit 374 Zeilen ohnehin an der Grenze, an der ein eigenes Formular-Modul angebracht
ist.

Sichtbar nur mit `investigations:manage`. Zusätzlich ein Löschen-Knopf hinter einer
Bestätigung, sichtbar mit `investigations:delete`; die Route sperrt sich bei
verknüpften Akten selbst (`api/vehicles/[id]/route.ts` DELETE).

## Teil 4 — Einsatzakten in der Linkfreigabe

Der Pfad ist statisch korrekt: `CASE` steht im Bereichs-Dropdown
(`record-share-validation.ts:3`), `shareCandidates()` fragt sauber ab
(`src/lib/record-shares.ts:69`), und ein Fehler würde in der Oberfläche angezeigt
statt verschluckt (`share-manager.tsx`). Eine leere Liste hat also eine von zwei
Ursachen, und welche, lässt sich nur an echten Daten feststellen:

1. Es gibt keine für den Nutzer sichtbaren `Investigation`-Datensätze. Dann löst
   Teil 1 das Problem von selbst, sobald die Unterakten konvertiert sind.
2. Ein Sichtbarkeits- oder Query-Effekt in `investigationVisibilityWhere()`
   (`src/lib/investigations.ts:252`).

**Vorgehen: erst reproduzieren, dann fixen.** Schritt eins ist ein Diagnoseschritt
gegen die Datenbank — `Investigation`-Gesamtzahl, davon `classified`, und ein
direkter Aufruf von `shareCandidates()` mit dem betroffenen Benutzerkontext. Erst
das Ergebnis entscheidet, ob überhaupt und was gefixt wird. Ein Fix ins Blaue wird
hier nicht geschrieben.

## Tests

- `tests/` nutzt `tsx --test`. Neue Tests:
  - **Ankerbestimmung**: verschachtelte FILE-Ketten, FILE auf Wurzelebene,
    Nicht-FILE-Kinder unter FILE. Reine Funktion, ohne Datenbank prüfbar.
  - **Feldabbildung**: `description` + `address` → `summary`.
  - **Freigabe-Umschreibung**: Normalfall und Unique-Kollision.
- Der Dry-Run gegen die echte Datenbank ist die Abnahme für den Rest: sein Report
  muss die erwarteten Umwandlungen zeigen, bevor `--apply` läuft.

## Reihenfolge

1. Diagnose Linkfreigabe (Teil 4, Schritt eins) — unabhängig, liefert früh Klarheit.
2. Migrationsskript samt Tests, Dry-Run gegen die Datenbank.
3. `--apply` nach Backup.
4. `FILE` aus dem Code (Teil 2) — erst nach erfolgreicher Migration, sonst lassen
   sich Altdaten nicht mehr anzeigen.
5. Fahrzeugakten bearbeiten (Teil 3) — unabhängig, jederzeit möglich.
6. Fix Linkfreigabe, falls die Diagnose einen ergibt.

## Risiken

- **Unumkehrbar.** Unterakten werden gelöscht; Adresse und Verschachtelung gehen als
  eigenständige Struktur verloren. Abgesichert durch Pflicht-Backup, Dry-Run-Default
  und den ID-Report.
- **Aktenzeichen.** `nextInvestigationCaseNumber()` liest alle vorhandenen Nummern
  und zählt hoch. Innerhalb der Migration muss fortlaufend gezählt werden, ohne pro
  Datensatz neu zu lesen — sonst vergibt ein Lauf dieselbe Nummer mehrfach und
  läuft in den Unique-Index.
- **Laufzeit.** Serializable-Transaktion über den gesamten Bestand. Bei vielen
  Unterakten ist ein Batch-Betrieb nötig; die tatsächliche Zahl klärt der Dry-Run.

# Karte ↔ Akten, Bild-Upload und Akten-Wizard

Design vom 2026-09-09.

## Ziel

Vier zusammenhängende Verbesserungen an den Ermittlungsakten:

1. **Kartenpunkte lassen sich mit Akten verknüpfen.** Eine Dauerakte
   bündelt mehrere Kartenpunkte – die Routen und Sammler, die eine
   Familie beansprucht. Eine Einsatzakte verweist auf die Punkte, an
   denen der Einsatz stattfand.
2. **Bilder lassen sich bei Einsatzakten hochladen.** Bisher kommen
   alle Bilder ausschließlich über den Discord-Sync in den Bildkatalog.
3. **Das Anlegen einer Akte wird ein Mehrschritt-Wizard.** Die
   heutigen Dialoge sind ein einziges langes Formular; bei der
   Dauerakte stehen vier Beziehungs-Picker ungeordnet untereinander.
4. **Der Verschlusssache-Haken ist beim Anlegen einer Einsatzakte
   vorangekreuzt.** Heute ist er standardmäßig aus.

## Ausgangslage

- `MapSpot` (`prisma/schema.prisma`) hat keine Beziehung zu Akten –
  nur Titel, Beschreibung, Kategorie, Icon und x/y in Prozent.
- `Dossier` führt Register für Personen, Einsatzakten, Fahrzeuge und
  Bodycams als implizite m:n-Relationen. Für Orte gibt es nur das
  Freitextfeld `address`.
- `InvestigationPhoto` verlangt `sourceKey`, `channelId` und
  `messageId` – alles Discord-Herkunft. Es gibt keinen Upload-Weg.
- `investigations-workspace.tsx` und `DossierEditor` in
  `dossiers-workspace.tsx` sind je ein einzelnes `Modal` mit einem
  langen Formular.
- `emptyForm()` in `investigations-workspace.tsx` setzt
  `classified: false`.

## Datenmodell

Drei implizite m:n-Relationen im Stil der vorhandenen
`DossierPersons` / `DossierVehicles`:

```prisma
model MapSpot {
  dossiers       Dossier[]       @relation("DossierMapSpots")
  investigations Investigation[] @relation("InvestigationMapSpots")
}

model Dossier {
  mapSpots MapSpot[] @relation("DossierMapSpots")
}

model Investigation {
  mapSpots MapSpot[]            @relation("InvestigationMapSpots")
  photos   InvestigationPhoto[] @relation("InvestigationPhotos")
}
```

`InvestigationPhoto` wird für Uploads geöffnet:

```prisma
model InvestigationPhoto {
  sourceKey      String?  @unique   // null = per Upload angelegt
  channelId      String?
  messageId      String?
  uploadedById   String?
  uploadedBy     User?    @relation("PhotoUploader", fields: [uploadedById], references: [id], onDelete: SetNull)
  investigations Investigation[] @relation("InvestigationPhotos")
}
```

Auf `User` kommt die Gegenseite dazu:

```prisma
model User {
  photosUploaded InvestigationPhoto[] @relation("PhotoUploader")
}
```

`sourceKey` bleibt `@unique`: MariaDB erlaubt beliebig viele NULLs in
einem Unique-Index, der Discord-Import bleibt also idempotent.
Bestehende Zeilen ändern sich nicht; `importMessage()` in
`src/lib/investigation-photos.ts` bleibt unverändert.

Migration über `npm run db:push` – das Skript legt vorher ein Backup an.

## Entscheidungen zur Sichtbarkeit

**Kartenpunkte bleiben für jeden mit `map:view` sichtbar.** Gefiltert
werden nur die *Verknüpfungen*. Würde ein Punkt verschwinden, sobald
ihn jemand an eine Verschlusssache hängt, verriete sein Verschwinden
genau die Information, die geschützt werden soll.

**Verknüpfte Einsatzakten laufen überall durch
`investigationVisibilityWhere(user)`** – in der Spot-Liste, im
Spot-Detail und in der Dauerakte. Das entspricht der Behandlung von
Bodycam-Clips in `saveDossier()`.

**Einen neuen Kartenpunkt aus dem Wizard heraus anzulegen erfordert
`map:manage`.** Fehlt das Recht, zeigt der Picker nur die Auswahl
bestehender Punkte, keinen Anlegen-Button.

**Der Bild-Upload erfordert `investigations:manage`** – dasselbe Recht
wie das Anlegen einer Akte.

## API

| Route | Änderung |
|---|---|
| `POST /api/investigations/photos/upload` | **neu.** `investigations:manage`. Rohbody-Stream plus `Content-Type`, Titel als Query-Parameter – dasselbe Muster wie `saveEvidence()` in `src/lib/corruption-evidence.ts`. Typprüfung über das vorhandene `detectPhotoType()` anhand der Magic Bytes, nicht anhand des Headers. Limit 20 MB wie beim Discord-Import. Ablage in `uploads/investigation-photos/` über `photoPath()`. Antwort: `CatalogPhoto`. |
| `POST` / `PATCH /api/investigations[/:id]` | akzeptieren `mapSpotIds` und `photoIds`. |
| `GET /api/investigations/:id` | liefert `mapSpots` und `photos` mit. |
| `dossierSchema` (`src/lib/dossiers-server.ts`) | `mapSpotIds: string[]`, validiert und verknüpft wie `vehicleIds` (`set`-Semantik). |
| `GET /api/map/spots` | liefert je Punkt `dossiers` und `investigations` mit, letztere sichtbarkeitsgefiltert. Eine Einzel-GET-Route für Kartenpunkte gibt es nicht und braucht es nicht – der Detaildialog arbeitet auf dem bereits geladenen Listeneintrag. |

Bei Einsatzakten wird für `mapSpotIds` und `photoIds` `set`-Semantik
verwendet: beides ist nicht sichtbarkeitsbeschränkt, daher braucht es
nicht den `disconnect`/`connect`-Umweg, den `saveDossier()` für
Einsatzakten und Clips geht.

## UI-Bausteine

**`src/components/ui/wizard.tsx`** – generischer Rahmen für beide
Flows. Nummerierte Schrittleiste, Zurück/Weiter, pro Schritt eine
`valid`-Prüfung, optionale Schritte mit „Überspringen".

- Beim **Anlegen** ist die Navigation linear: Weiter erst, wenn der
  Schritt gültig ist.
- Beim **Bearbeiten** sind alle Schritte direkt anklickbar und
  Speichern ist jederzeit möglich. So braucht eine
  Tippfehlerkorrektur keine fünf Klicks, und es bleibt trotzdem bei
  einer Formularimplementierung statt zweier.

**`src/components/map/spot-picker.tsx`** – Auswahlfläche mit der
echten `CityMap` links und einer suchbaren Liste rechts. Punkte werden
per Klick auf Nadel oder Listeneintrag an- und abgewählt; angewählte
Nadeln bekommen einen Ring. „Neuen Punkt setzen" schaltet in den
Platzierungsmodus, den die Kartenseite bereits kennt, und legt den
Punkt über `POST /api/map/spots` an.

`CityMap` bekommt dafür zwei optionale Props – `selectedIds` und
`selectable`. Kein zweiter Kartenrenderer.

**`PhotoPicker`** – Mehrfachauswahl auf Basis der vorhandenen
`PhotoGrid`, plus Upload-Button. Der vorhandene `PhotoField`
(Einzelbild für Dauerakten) bekommt denselben Upload-Button.

Hochgeladene Bilder landen im gemeinsamen Bildkatalog und sind danach
überall wählbar – auch als Foto einer Personen-, Familien- oder
Anwesenakte. Die Katalogseite `/investigations/photos` zeigt beide
Quellen gemischt mit einem Herkunftshinweis pro Bild.

## Wizard: Dauerakte

Ersetzt `DossierEditor` in `dossiers-workspace.tsx`. Schritte 2 bis 4
sind überspringbar.

| # | Schritt | Inhalt |
|---|---|---|
| 1 | Art & Titel | Kategorie als vier anklickbare Karten mit Erklärtext statt Dropdown, Titel, übergeordnete Akte |
| 2 | Beschreibung | Adresse, Foto, Notizen |
| 3 | Kartenpunkte | Routen, Sammler, Anwesen – der Spot-Picker |
| 4 | Verknüpfungen | Personen, Einsatzakten, Fahrzeuge, Bodycams |
| 5 | Prüfen | Zusammenfassung, dann Speichern |

## Wizard: Einsatzakte

Ersetzt den Anlegen-Dialog in `investigations-workspace.tsx`. Schritte
3 und 4 sind überspringbar.

| # | Schritt | Inhalt |
|---|---|---|
| 1 | Anlass | Titel, Zusammenfassung, Status, Priorität |
| 2 | Zuständigkeit | Fallführung, zugewiesene Ermittler, Verschlusssache |
| 3 | Kartenpunkte | „Fand der Einsatz an einer bekannten Route oder einem Sammler statt?" |
| 4 | Bilder | Katalog und Upload |
| 5 | Prüfen | Zusammenfassung, dann Anlegen |

## Verschlusssache als Voreinstellung

`emptyForm()` setzt `classified: true`. Der Haken steht in Schritt 2
mit umgedrehtem Erklärtext: nicht „Verschlusssache aktivieren",
sondern sichtbar als Voreinstellung, die man bewusst abwählt, um die
Akte für alle Ermittler zu öffnen.

Der Prisma-Default (`@default(false)`) und der API-Default bleiben
unverändert. Das Formular schickt den Wert immer explizit mit, und
Akten, die über API oder Import entstehen, sollen sich nicht
stillschweigend im Verhalten ändern. Bestehende Akten bleiben
unberührt.

## Rückrichtung

Ohne diese wäre die Verknüpfung nur von einer Seite sichtbar:

- **`spot-detail-dialog.tsx`**: Abschnitt „Verknüpfte Akten" mit
  Links, sichtbarkeitsgefiltert.
- **`investigation-detail.tsx`**: zwei neue Karten „Kartenpunkte" und
  „Bilder", jeweils mit Nachpflegen-Möglichkeit.
- **`dossiers-workspace.tsx`**: „Kartenpunkte" als fünftes Register
  neben Personen, Einsatzakten, Fahrzeugen und Bodycams, inklusive
  der vorhandenen Schnellverknüpfung (`QuickRelationEditor`).

## Absicherung

Automatisiert, im Stil der vorhandenen Tests unter `tests/`:

- Upload-Validierung: Magic-Bytes-Prüfung weist eine als Bild
  deklarierte Nicht-Bilddatei ab; Größenlimit greift; nicht
  unterstützte Typen werden abgelehnt.
- Sichtbarkeit: eine Verschlusssache erscheint für Unbefugte nicht in
  den Verknüpfungen eines Kartenpunkts.
- Dossier-Speicherung: `mapSpotIds` verknüpft und trennt korrekt.

Manuell durchzuklicken:

- beide Wizards, jeweils Anlegen und Bearbeiten,
- Bild-Upload und anschließende Wiederverwendung des Bildes an einer
  Personenakte,
- Discord-Sync importiert nach dem Nullable-Umbau weiterhin.

## Bewusst nicht enthalten

- Keine Rollen oder Notizen pro Kartenpunkt-Verknüpfung. Wenn sich
  später herausstellt, dass „Route" und „Sammler" pro Verknüpfung
  unterschieden werden müssen, kommt ein explizites
  Verknüpfungsmodell dazu – vorerst reicht die Kategorie am Punkt.
- Keine Sichtbarkeitslogik für Dauerakten. Es gibt heute kein
  `classified` auf `Dossier`, und dieser Umbau führt keines ein.
- Kein Wizard für andere Aktenarten (Personen, Fahrzeuge).

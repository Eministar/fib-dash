# Ermittlungsgruppen an Dauerakten

Datum: 2026-09-13

## Problem

Zugriff auf eine Verschlusssache hat heute nur, wer sie angelegt hat, sie führt,
ihr namentlich zugewiesen ist oder `investigations:classified` besitzt
(`src/lib/investigations.ts:252`). Eine Ermittlungsgruppe, die dauerhaft an einer
Familie oder Gruppierung arbeitet, muss deshalb an jeder einzelnen Einsatzakte
nachgetragen werden — und bei jeder neuen Akte wieder.

## Ziel

Eine Dauerakte kann Ermittlungsgruppen führen. Wer Mitglied einer solchen Gruppe
ist, sieht alle Einsatzakten dieser Dauerakte **und aller Akten darunter**,
Verschlusssachen eingeschlossen. Tritt jemand der Gruppe bei, hat er den Zugriff
sofort; tritt er aus, ist er sofort weg.

## Entscheidungen (vom Nutzer bestätigt)

- Zugewiesen werden **ganze Ermittlungsgruppen** (`LeadershipGroup`), keine
  einzelnen Agents.
- Der Zugriff umfasst **Verschlusssachen**.
- Der Zugriff **vererbt sich im Aktenbaum nach unten**.

## Nicht-Ziele

- Keine Änderung daran, wer Akten *bearbeiten* darf. Die Zuweisung gewährt
  ausschließlich Lesezugriff über die bestehende Sichtbarkeitsprüfung.
- Keine Zuweisung einzelner Agents an Dauerakten.
- Keine Änderung an der Verwaltung der Ermittlungsgruppen selbst (Leadership).

## Datenmodell

```prisma
model DossierAccessGroup {
  dossierId String
  groupId   String
  dossier   Dossier         @relation(fields: [dossierId], references: [id], onDelete: Cascade)
  group     LeadershipGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  addedById String?
  addedBy   User?           @relation("DossierAccessGrantor", fields: [addedById], references: [id], onDelete: SetNull)
  createdAt DateTime        @default(now())

  @@id([dossierId, groupId])
  @@index([groupId])
}
```

Gegenstücke: `Dossier.accessGroups`, `LeadershipGroup.dossierAccess`,
`User.dossierAccessGranted`.

Mitgliedschaft wird **nicht** kopiert — sie bleibt in `LeadershipGroupMember` und
wird bei jeder Prüfung frisch gelesen. Nur so wirkt ein Gruppenaustritt sofort.

Schemaänderung über `npm run db:push` (sichert vorher). Kein SQL-Patch nötig.

## Die Sichtbarkeitsprüfung

`investigationVisibilityWhere(user)` ist heute synchron und baut die Bedingung
allein aus dem User-Objekt. Beide Anforderungen sprengen das: die
Gruppenmitgliedschaft steht nicht im User-Objekt, und „ein Vorfahre im Aktenbaum
ist zugewiesen" lässt sich in einem Prisma-`where` nicht ausdrücken.

Die Funktion wird deshalb **`async`** und behält ihren Namen. Der geänderte
Rückgabetyp (`Promise<…>`) lässt jede der 18 Aufrufstellen (in 13 Dateien) im
Typcheck auffallen — keine kann übersehen werden. Eine synchrone Variante bleibt
**nicht** daneben stehen; sonst benutzt sie irgendwann jemand versehentlich und
prüft zu wenig.

```ts
export async function investigationVisibilityWhere(user: CurrentUser): Promise<Prisma.InvestigationWhereInput> {
  if (hasPermission(user, 'investigations:classified')) return {}

  const openings: Prisma.InvestigationWhereInput[] = [
    { classified: false },
    { createdById: user.id },
  ]
  if (user.discordId) {
    openings.push({ leadAgent: { discordId: user.discordId } })
    openings.push({ assignees: { some: { agent: { discordId: user.discordId } } } })
  }

  const dossierIds = await accessibleDossierIds(user)
  if (dossierIds.length) openings.push({ dossiers: { some: { id: { in: dossierIds } } } })

  return { OR: openings }
}
```

`accessibleDossierIds(user)` (neu, `src/lib/dossier-access.ts`):

1. Ermittlungsgruppen des Nutzers aus `LeadershipGroupMember`. Keine → `[]`,
   kein weiterer Aufwand.
2. Deren Dauerakten aus `DossierAccessGroup`. Keine → `[]`.
3. `Dossier(id, parentId)` in einem Rutsch laden und den Baum in JS nach unten
   aufklappen.

Für Nutzer ohne `investigations:classified` und ohne Gruppe kostet das eine
zusätzliche Abfrage, mit Gruppe drei. Alle drei sind klein. `accessibleDossierIds`
wird mit Reacts `cache()` umschlossen, damit mehrere Prüfungen innerhalb einer
Anfrage sie nur einmal ausführen.

Das Aufklappen des Baums ist eine **reine Funktion** und damit ohne Datenbank
prüfbar:

```ts
export function expandDescendants(rootIds: string[], tree: { id: string; parentId: string | null }[]): string[]
```

Sie muss Zyklen aushalten: `validateDossierParent` verhindert sie nur beim
Speichern über die API, Altdaten können andere Wege genommen haben. Ein Zyklus
darf die Prüfung nicht aufhängen — das wäre ein Totalausfall der Ermittlungen.

### Fallstrick: Transaktionen

`saveDossier` ruft die Prüfung **innerhalb** einer Serializable-Transaktion auf
(`src/lib/dossiers-server.ts:67`). Eine Abfrage über den globalen `prisma`-Client
liefe dort auf einer anderen Verbindung und könnte unter Last blockieren. Die
Sichtbarkeitsbedingung wird deshalb **vor** `prisma.$transaction` berechnet und
als Wert hineingereicht.

## Schnittstellen

- `GET /api/investigations/dossiers/[id]` liefert `accessGroups` mit
  (`{ id, name }` je Gruppe).
- `POST /api/investigations/dossiers/[id]/access-groups` — Body `{ groupId }`,
  verlangt `investigations:manage`, Audit-Eintrag `DOSSIER_ACCESS_GRANTED`.
- `DELETE /api/investigations/dossiers/[id]/access-groups?groupId=…` — dieselbe
  Berechtigung, Audit-Eintrag `DOSSIER_ACCESS_REVOKED`.
- `GET /api/leadership/groups/options` — `[{ id, name }]`, verlangt
  `investigations:manage`.

Die Vergabe läuft bewusst über eigene Routen statt über `dossierSchema`: es ist
eine Rechteänderung, und die gehört einzeln ins Audit-Log, nicht als Nebeneffekt
eines Akten-Updates.

### Vertraulichkeit der Gruppennamen

`leadership-groups:manage` ist als vertraulich ausgewiesen, und `listGroups`
zeigt heute nur Mitgliedern und Verwaltern etwas (`leadershipGroupVisibility`).
`/api/leadership/groups/options` weicht das bewusst auf: **Namen und IDs** aller
Gruppen werden für Inhaber von `investigations:manage` sichtbar. Mitglieder,
Familien, Kanäle und Leitungen bleiben draußen. Ohne diese Aufweichung ließe sich
keine Gruppe auswählen. Der Nutzer hat sie bestätigt.

## Oberfläche

**Dauerakte, Reiter „Beteiligte"** — Rubrik *Ermittlungsgruppen*: Liste der
zugewiesenen Gruppen mit Entfernen-Knopf, darüber eine Auswahl zum Hinzufügen.
Sichtbar für alle mit `investigations:view`, änderbar mit `investigations:manage`.
Ein Hinweissatz benennt die Tragweite: *„Mitglieder dieser Gruppen lesen alle
Einsatzakten dieser Akte und aller Akten darunter — auch Verschlusssachen."*

**Einsatzakte** — eine Zeile in den Eckdaten, woher ein Zugriff sonst noch kommt:
*„Zugriff auch über Dauerakte Gruppierung Elite → Ermittlungsgruppe Nord"*. Bei
einer Rechtevergabe, die nicht an der Akte selbst steht, ist das kein Luxus:
sonst kann niemand beantworten, wer die Akte lesen darf. Die Auflösung läuft den
Baum **nach oben** — eine Einsatzakte an Akte D ist über Zuweisungen an D und an
jedem Vorfahren von D erreichbar. Auch das ist eine reine Funktion:

```ts
export function accessPathsFor(
  dossierIds: string[],
  tree: { id: string; parentId: string | null; title: string }[],
  grants: { dossierId: string; groupId: string; groupName: string }[],
): { dossierTitle: string; groupName: string }[]
```

## Tests

Reine Funktionen in `tests/dossier-access.test.ts`, ohne Datenbank:

- `expandDescendants`: eine Ebene, mehrere Ebenen, Geschwister bleiben draußen,
  zwei Wurzeln überlappen, Zyklus bricht ab, leere Eingabe.
- `accessPathsFor`: Zuweisung an der Akte selbst, an einem Vorfahren, an mehreren
  Vorfahren, keine Zuweisung.
- `investigationVisibilityWhere`: mit `investigations:classified` unverändert
  `{}`; ohne Gruppen identisch zum heutigen Ergebnis (Regressionsschutz); mit
  Gruppen kommt genau ein `dossiers`-Zweig hinzu.

## Reihenfolge

1. Reine Funktionen `expandDescendants` und `accessPathsFor` samt Tests.
2. Schema plus `db:push`.
3. `investigationVisibilityWhere` auf `async` umstellen, alle 18 Aufrufstellen
   nachziehen, `saveDossier` vor die Transaktion ziehen.
4. Routen für Vergabe und Entzug, Gruppenauswahl.
5. Oberfläche an Dauerakte und Einsatzakte.

## Risiken

- **Blast Radius.** 18 Aufrufstellen in 13 Dateien entscheiden über Sichtbarkeit, darunter
  Suche, Karte, Bodycams und Freigabelinks. Der geänderte Rückgabetyp zwingt
  jede einzelne in den Typcheck; trotzdem gehört nach der Umstellung ein Blick
  auf jede Stelle, ob das `await` an der richtigen Stelle sitzt und das Ergebnis
  wiederverwendet statt neu berechnet wird.
- **Vererbung ist scharf.** Wer an einer Hauptakte hängt, liest jede
  Verschlusssache darunter, auch die, die später jemand anders dort anlegt. Das
  ist gewollt und steht so in der Oberfläche.
- **Zyklen im Baum** dürfen die Prüfung nicht aufhängen. Deshalb der
  Zyklenschutz in `expandDescendants` und ein Test dafür.
- **Kein Rückweg über die Freigabelinks.** `record-shares.ts` benutzt dieselbe
  Prüfung; ein Gruppenmitglied kann damit künftig Verschlusssachen in einen
  öffentlichen Leselink legen. Das entspricht der heutigen Logik für zugewiesene
  Ermittler und wird nicht gesondert eingeschränkt — die Oberfläche warnt dort
  bereits sichtbar vor Verschlusssachen in einer Freigabe.

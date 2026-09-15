# Freie Verträge – eigenständiges Vertragsmodul

Stand: 2026-09-15

## Ausgangslage

Das bestehende Vertragssystem (`Contract`, `ContractTemplate`, `ContractSignature`)
hängt am HR-Bereich: Arbeitsverträge für Agents, Discord-Versand, Rechte
`contracts:*`, Tab „Verträge“ unter HR. Die Behördenverträge
(`src/components/contracts/agency-contracts.tsx`) sind gebaut, aber nirgends
eingebunden, und kennen nur zwei Parteien, von denen eine das FIB ist.

## Ziel

Ein Modul, das von HR, Agents und dem bestehenden Vertragssystem **unabhängig**
ist und in dem sich beliebige Verträge frei aufsetzen und von beliebig vielen
Parteien per Link unterschreiben lassen.

## Entscheidungen

1. **Parteien sind frei eintippbar**, beliebig viele je Vertrag (mindestens eine).
2. **Unterschrift nur über den Link.** Wer den Link hat, unterschreibt für seine
   Partei. Kein Discord-Login.
3. **Links im Klartext gespeichert**, jederzeit wieder kopierbar. Bewusste
   Abwägung: Wer Datenbankzugriff hat, kann unterschreiben.
4. **Eigene Rechte** `agreements:view` und `agreements:manage`, eigener Menüpunkt.
5. **Eigene Vorlagen**, getrennt von den HR-Vorlagen.
6. **Entwurf, dann gesperrt.** Freigeben sperrt den Text und aktiviert die Links.
7. **Beim Unterschreiben nur Name und Lesebestätigung**, keine weiteren Felder.
8. **Briefkopf je Vertrag wählbar:** FIB oder neutral.
9. **Eigene Tabellen** (Ansatz A), keine Wiederverwendung von `Contract`.

## Nicht-Ziele

- Keine Verbindung zu Agents, Bewerbungen, Discord-Versand oder HR-Meldungen.
- Keine frei definierbaren Felder für Unterzeichner.
- Keine kryptografische Signatur, kein Zeitstempeldienst. Beweissicherung:
  Zeitpunkt, getippter Name, IP, User-Agent.
- Keine Platzhalter (`{{name}}` o. ä.). Datum und Ort schreibt der Verfasser selbst.
- Keine Migration oder Umbau der bestehenden HR-Verträge und Behördenverträge.

## Datenmodell

```prisma
/// Frei aufgesetzter Vertrag, unabhängig von HR und Agents.
model Agreement {
  id          String   @id @default(cuid())
  title       String   @db.VarChar(200)
  /// DRAFT | OPEN | SIGNED | DECLINED | CANCELLED
  status      String   @default("DRAFT") @db.VarChar(20)
  /// FIB | NEUTRAL
  letterhead  String   @default("FIB") @db.VarChar(20)
  /// Präambel (Markdown).
  content     String   @db.Text
  /// [{ id, title, body, sortOrder }] – wie ContractClause.
  clauses     Json
  closing     String?  @db.Text
  /// Nur zur Anzeige „aus Vorlage X“; keine Bindung.
  templateId  String?
  template    AgreementTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  releasedAt  DateTime?
  cancelledAt DateTime?
  createdById String?
  createdBy   User?    @relation("AgreementCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parties AgreementParty[]

  @@index([status, updatedAt])
}

/// Eine Vertragspartei mit eigenem Unterschrifts-Link.
model AgreementParty {
  id          String    @id @default(cuid())
  agreementId String
  agreement   Agreement @relation(fields: [agreementId], references: [id], onDelete: Cascade)
  name        String    @db.VarChar(200)
  role        String?   @db.VarChar(200)
  sortOrder   Int       @default(0)
  /// base64url, 32 Byte. Klartext, siehe Entscheidung 3.
  token       String    @unique @db.VarChar(64)

  signedAt        DateTime?
  signedName      String?   @db.VarChar(200)
  signedIp        String?   @db.VarChar(64)
  signedUserAgent String?   @db.VarChar(200)
  declinedAt      DateTime?
  declineReason   String?   @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([agreementId, sortOrder])
}

/// Vorlage für freie Verträge – getrennt von ContractTemplate.
model AgreementTemplate {
  id          String   @id @default(cuid())
  name        String   @db.VarChar(120)
  letterhead  String   @default("FIB") @db.VarChar(20)
  content     String   @db.Text
  clauses     Json
  closing     String?  @db.Text
  createdById String?
  createdBy   User?    @relation("AgreementTemplateCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  agreements Agreement[]
}
```

Regelungen werden mit dem vorhandenen `sanitizeContractClauses` aus
`src/lib/contracts.ts` bereinigt. Das ist eine reine Hilfsfunktion ohne HR-Bezug.

## Status-Ablauf

| Von | Aktion | Nach | Bedingung |
|---|---|---|---|
| – | Anlegen | `DRAFT` | – |
| `DRAFT` | Bearbeiten | `DRAFT` | – |
| `DRAFT` | Löschen | – | – |
| `DRAFT` | Freigeben | `OPEN` | Titel gesetzt, mindestens eine Partei |
| `OPEN` | Unterschrift einer Partei | `OPEN` oder `SIGNED` | `SIGNED`, wenn alle Parteien unterschrieben haben |
| `OPEN` | Ablehnung einer Partei | `DECLINED` | – |
| `DRAFT`, `OPEN` | Zurückziehen | `CANCELLED` | – |
| beliebig | Duplizieren | neuer `DRAFT` | Text, Briefkopf und Parteien (ohne Unterschriften, neue Tokens) |

Der Status wird nach jeder Unterschrift oder Ablehnung aus allen
Parteizeilen neu berechnet (`deriveAgreementStatus`, reine Funktion).

## Links

- Token: `randomBytes(32).toString('base64url')`, erzeugt beim Anlegen einer Partei.
- Links sind nur wirksam, solange der Vertrag `OPEN` ist. Bei `DRAFT` zeigt die
  Seite „noch nicht freigegeben“, bei `SIGNED`, `DECLINED`, `CANCELLED` nur das
  Dokument.
- Eingehende Tokens laufen durch `normalizeLinkToken` (`src/lib/link-tokens.ts`).
- Nach dem Nachschlagen wird `party.token === token` exakt verglichen. Die
  Datenbank-Kollation unterscheidet keine Groß-/Kleinschreibung.
- **Link neu erzeugen:** ersetzt den Token einer Partei. Nur solange diese Partei
  weder unterschrieben noch abgelehnt hat.

## Rechte

In `src/lib/permissions.ts`:

- `agreements:view` – „Freie Verträge ansehen“
- `agreements:manage` – „Freie Verträge und Vorlagen verwalten“, impliziert
  `agreements:view`

Keine Implikation auf oder von `hr:*`, `contracts:*` oder `agents:*`.

## Serverlogik

`src/lib/agreements.ts` (ohne Node-Imports, auch vom Client nutzbar):
Status-Labels, `deriveAgreementStatus`, Validierung der Eingaben (zod).

`src/lib/agreement-service.ts`:

- `createAgreement`, `updateAgreement` (nur `DRAFT`), `deleteAgreement` (nur `DRAFT`)
- `releaseAgreement`, `cancelAgreement`, `duplicateAgreement`
- `regeneratePartyToken`
- `loadPartyByToken` (inklusive exaktem Vergleich)
- `signParty`, `declineParty`: schreiben mit `updateMany` und der Bedingung
  `signedAt: null, declinedAt: null` sowie Vertrag `OPEN`. Bei `count === 0` gilt
  der Vorgang als bereits erledigt oder unzulässig. Danach Statusabgleich über
  alle Zeilen in derselben Transaktion.
- Vorlagen: `createTemplate`, `updateTemplate`, `deleteTemplate`

## API

Intern (Session, Rechte):

| Methode | Pfad | Recht |
|---|---|---|
| GET | `/api/agreements` (Suche, Statusfilter) | view |
| POST | `/api/agreements` | manage |
| GET | `/api/agreements/[id]` (inkl. Parteien und Links) | view |
| PATCH | `/api/agreements/[id]` | manage |
| DELETE | `/api/agreements/[id]` | manage |
| POST | `/api/agreements/[id]/release` | manage |
| POST | `/api/agreements/[id]/cancel` | manage |
| POST | `/api/agreements/[id]/duplicate` | manage |
| POST | `/api/agreements/[id]/parties/[partyId]/token` | manage |
| GET, POST | `/api/agreement-templates` | view / manage |
| PATCH, DELETE | `/api/agreement-templates/[id]` | manage |

Öffentlich (ohne Login, Header wie `publicShareHeaders`):

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/agreement-links/[token]` | Dokument, eigene Partei, Formular erlaubt ja/nein |
| POST | `/api/agreement-links/[token]` | `{ action: 'sign', name, confirmed }` oder `{ action: 'decline', reason }` |

Die öffentliche Antwort enthält von anderen Parteien nur Name, Funktion,
Unterschriftsname, Datum und Ablehnungsvermerk – nie Tokens, IP oder User-Agent.

## Oberfläche

**`AgreementDocument`** (`src/components/agreements/agreement-document.tsx`):
nutzt die CSS-Klassen `contract-paper`, `contract-clause` usw. aus `globals.css`.
`ContractDocument` bleibt unverändert.

- Briefkopf `FIB`: Wappen, Wasserzeichen, Titel „Federal Investigation Bureau“,
  Stempel sobald `SIGNED`.
- Briefkopf `NEUTRAL`: kein Logo, kein Wasserzeichen, kein Stempel.
- Kopfzeile listet alle Parteien mit Funktion.
- Präambel, § 1 … § n, Abschluss.
- Unterschriftsraster mit einem Block je Partei.
- Markierung „Abgelehnt“ bzw. „Ungültig“ bei `DECLINED` bzw. `CANCELLED`.

**Seite `/vertraege`** (Sidebar-Eintrag „Verträge“, Recht `agreements:view`):

- Tab **Verträge**: Liste mit Titel, Parteien, Status, „x von y unterschrieben“,
  Suche und Statusfilter. Detailansicht mit Dokumentvorschau, Link je Partei
  mit Kopieren-Knopf und Status, Aktionen gemäß Status-Ablauf.
- **Editor**: Vorlage wählen oder leer, Titel, Briefkopf, Parteien
  (hinzufügen, entfernen, sortieren), Präambel, Regelungen (hinzufügen,
  verschieben, entfernen), Abschluss, „Als Vorlage sichern“.
- Tab **Vorlagen**: anlegen, bearbeiten, löschen. Gleicher Editor ohne Parteien.
- Aktionen, die `agreements:manage` erfordern, sind ohne das Recht ausgeblendet.

**Seite `/unterschrift/[token]`** (öffentlich):

- Dokument mit bisherigen Unterschriften.
- Hinweis „Sie unterschreiben für: <Partei>“.
- Formular: vollständiger Name, Häkchen „Ich habe den Vertrag gelesen“,
  „Unterschreiben“, „Ablehnen“ mit optionalem Grund.
- Hinweis, dass der Link persönlich ist.
- `noindex`, kein Caching.

## Fehlerfälle

- **Unbekannter Token:** neutrale Seite „Link ungültig“, API 404 ohne Hinweis
  auf Existenz.
- **Vertrag nicht `OPEN`:** POST liefert 409 mit passender Meldung. Die Seite
  zeigt nur das Dokument.
- **Partei hat bereits unterschrieben oder abgelehnt:** 409, Seite zeigt Dokument.
- **Doppelklick oder gleichzeitige Unterschriften:** bedingtes `updateMany`
  verhindert doppelte Unterschrift. Der Statusabgleich liest danach alle Zeilen.
- **Bearbeiten oder Löschen außerhalb `DRAFT`:** 409.
- **Freigeben ohne Titel oder Parteien:** 400.
- **Link neu erzeugen nach Unterschrift oder Ablehnung:** 409.
- **Vorlage gelöscht:** Verträge behalten ihre Kopie, `templateId` wird `NULL`.
- **Name kürzer als 3 Zeichen oder Häkchen fehlt:** 400.

## Protokoll

`createAuditLog` mit den Aktionen `AGREEMENT_CREATED`, `AGREEMENT_UPDATED`,
`AGREEMENT_RELEASED`, `AGREEMENT_CANCELLED`, `AGREEMENT_DELETED`,
`AGREEMENT_TOKEN_REGENERATED`, `AGREEMENT_SIGNED`, `AGREEMENT_DECLINED`.
`details` enthält Vertragstitel und gegebenenfalls Parteiname.

## Tests

`tests/agreements.test.ts` (ohne Datenbank):

- `deriveAgreementStatus`: `OPEN` bis alle unterschrieben, dann `SIGNED`.
  `DECLINED`, sobald eine Partei ablehnt.
- Eingabevalidierung: leerer Titel, keine Parteien, zu kurzer Name.
- Token mit abweichender Groß-/Kleinschreibung wird von `loadPartyByToken`
  abgewiesen (Lookup injiziert).

`tests/agreements-db.test.ts` (Testdatenbank über `tests/db-env`):

- Vertrag aus Vorlage ist eine Kopie. Späteres Ändern der Vorlage ändert ihn nicht.
- Nach Freigeben lehnt `updateAgreement` ab.
- Link eines `DRAFT` erlaubt keine Unterschrift.
- Zweite Unterschrift derselben Partei wird abgewiesen.
- Drei Parteien: `SIGNED` erst nach der dritten Unterschrift.
- Nach „Link neu erzeugen“ ist der alte Token ungültig.

## Offene Punkte

Keine.

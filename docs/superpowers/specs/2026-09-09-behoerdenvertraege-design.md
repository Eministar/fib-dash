# Verträge mit externen Behörden

Stand: 2026-09-09

## Ausgangslage

Ein Vertragssystem existiert bereits und ist gut ausgebaut:

- `ContractTemplate` — Vorlagen mit Präambel (Markdown), einzeln bearbeitbaren
  Regelungen („§ 1, § 2, …"), Abschlusstext und frei definierbaren Feldern.
- `Contract` — eine eingefrorene Kopie der Vorlage. Spätere Vorlagenänderungen
  verändern bestehende Verträge nicht (`src/lib/contract-service.ts:142`).
- Feldtypen `SHORT_TEXT`, `LONG_TEXT`, `DATE`, `CHECKBOX`, `SIGNATURE`
  (`src/lib/contracts.ts:8`).
- Öffentlicher Signaturlink `/vertrag/<token>` mit Beweissicherung: Zeitpunkt,
  eingetragener Name, IP und User-Agent.
- Ein Dokument-Renderer mit Briefkopf, Wappen, Wasserzeichen, durchnummerierten
  Regelungen, Blocksatz mit Silbentrennung, Dienststempel nach Unterschrift und
  eigenem Druck-CSS (`src/components/contracts/contract-document.tsx`).
- Status `DRAFT` → `SENT` → `SIGNED` | `DECLINED` | `CANCELLED`.

## Problem

Das System ist fest auf **interne Agents** verdrahtet:

- `Contract.agentId` ist ein Pflichtfeld mit `onDelete: Cascade`.
- `Contract.signerDiscordId` bestimmt, wer unterschreiben darf; der Versand läuft
  über Discord-DM oder -Channel.
- Der Briefkopf zieht Vorname, Nachname, Dienstnummer, Rang und Einstellungsdatum
  aus dem Agent (`ContractDocumentData.agent`).
- Es gibt genau **eine** Unterschrift je Vertrag, abgelegt in den Spalten `token`,
  `signedAt`, `signedName`, `signedByUserId`, `signedIp`, `signedUserAgent`.

Eine andere Behörde ist kein Agent, hat keine Discord-ID, und ein Vertrag zwischen
zwei Behörden wird von **beiden Seiten** unterschrieben.

## Ziel

Verträge zwischen dem FIB und externen Behörden: frei aufsetzbar, ansehnlich
gesetzt, per Link teilbar, von beiden Seiten unterschreibbar — im vorhandenen
System, nicht daneben.

## Entscheidungen

Vier Festlegungen aus dem Brainstorming, die den Entwurf tragen:

1. **Beide Seiten unterschreiben, jede über ihren eigenen Link.** Der Vertrag gilt
   erst als geschlossen, wenn beide Unterschriften vorliegen.
2. **Die Gegenpartei wird je Vertrag frei eingetippt.** Kein Behördenverzeichnis —
   das wäre ein eigenes Feature und wird bewusst nicht gebaut.
3. **Verträge werden frei geschrieben**, optional ausgehend von einer Vorlage und
   optional als neue Vorlage gesichert. Die §-Struktur bleibt erhalten.
4. **Ein Vertragsbestand**, kein zweites paralleles Modell.

## Nicht-Ziele

- Kein Behördenverzeichnis, keine Stammdaten zu externen Parteien.
- Keine kryptografische Signatur, kein Zeitstempeldienst, keine eIDAS-Konformität.
  Die Beweissicherung bleibt wie bisher: Zeitpunkt, Name, IP, User-Agent.
- Kein automatischer Versand an externe Empfänger. Der Link wird kopiert und über
  einen bestehenden Kanal weitergegeben.
- Keine mehr als zweiseitigen Verträge in der Oberfläche. Das Datenmodell schließt
  sie nicht aus, die Oberfläche bietet sie nicht an.

## Architektur

### Unterschriften werden zu Zeilen

Die sechs Signaturspalten auf `Contract` weichen einem eigenen Modell. Das ist der
Kern des Umbaus und zugleich sein größtes Risiko, weil es durch Code läuft, der
heute funktioniert.

```prisma
/// Eine Partei, die diesen Vertrag unterschreibt. Jede bekommt einen eigenen
/// Link; der Vertrag ist geschlossen, wenn keine Zeile mehr offen ist.
model ContractSignature {
  id         String   @id @default(cuid())
  contractId String
  contract   Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  /// INTERNAL | EXTERNAL — bestimmt die Beschriftung im Dokument.
  side String @db.VarChar(20)
  /// Anzeigename der Partei, z. B. "Federal Investigation Bureau" oder
  /// "Los Santos Police Department".
  partyName String @db.VarChar(200)
  /// Funktion des Unterzeichners, z. B. "Direktor".
  partyRole String? @db.VarChar(200)
  /// Reihenfolge im Dokument; bestimmt auch die Anordnung der Signaturfelder.
  sortOrder Int @default(0)

  /// Eigener Link-Token dieser Partei.
  token String @unique
  /// Nur gesetzt, wenn die Partei intern ist: dann darf genau dieser
  /// Discord-Account unterschreiben.
  signerDiscordId String?

  signedAt        DateTime?
  signedName      String?
  signedByUserId  String?
  signedBy        User?     @relation("ContractSignatureSigner", fields: [signedByUserId], references: [id], onDelete: SetNull)
  signedIp        String?   @db.VarChar(64)
  signedUserAgent String?   @db.VarChar(200)
  /// Vom Unterzeichner eingetragene Werte dieser Partei.
  values          Json?

  declinedAt    DateTime?
  declineReason String?   @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([contractId, sortOrder])
}
```

Auf `Contract` ändert sich:

- `agentId String?` statt Pflichtfeld, Relation auf `onDelete: SetNull`. Ein
  gelöschter Agent darf einen unterschriebenen Vertrag nicht mitreißen — das ist
  nebenbei eine Verbesserung am bestehenden Verhalten.
- Neu: `kind String @default("AGENT") @db.VarChar(20)` — `AGENT` | `AGENCY`.
- Neu: `counterpartyName String? @db.VarChar(200)` und
  `counterpartyRole String? @db.VarChar(200)` als Kopfdaten für den Briefkopf.
- Die Spalten `token`, `signerDiscordId`, `signedAt`, `signedName`,
  `signedByUserId`, `signedIp`, `signedUserAgent`, `values`, `declinedAt`,
  `declineReason` entfallen — ihr Inhalt zieht in `ContractSignature`.
- `status` bleibt, wird aber abgeleitet: `SIGNED`, sobald jede Zeile
  unterschrieben ist; `DECLINED`, sobald eine abgelehnt hat.

### Migration

Ein einmaliges Skript unter `scripts/` erzeugt für jeden bestehenden Vertrag genau
eine `ContractSignature` mit `side = 'EXTERNAL'` (aus Sicht des FIB unterschreibt
dort der Agent, nicht die Behörde), `partyName` aus dem Agent-Namen, dem
vorhandenen `token`, `signerDiscordId` und allen Signaturdaten. Erst danach fallen
die alten Spalten weg.

Die Reihenfolge ist zwingend: **erst** das neue Modell samt Migration und grünen
Tests, **dann** das Entfernen der Spalten. Das Einstellungsverfahren hängt an
diesem Pfad; ein Fehler dort blockiert Neueinstellungen.

### Freies Aufsetzen

`createContractForAgent` bleibt unverändert für das Einstellungsverfahren. Daneben
tritt `createAgencyContract`:

- Nimmt Titel, Präambel, Regelungen, Abschluss, Felder direkt entgegen — ohne
  Vorlage.
- Optional `templateId` als Startpunkt: die Vorlage wird gelesen, ihr Inhalt
  vorbelegt und danach frei bearbeitet. Es bleibt eine Kopie, keine Bindung.
- Legt zwei `ContractSignature`-Zeilen an: `INTERNAL` (FIB, Vertreter frei
  eintragbar) und `EXTERNAL` (Behördenname und Funktion aus dem Formular).
- Die Platzhalterauflösung (`renderContractContent`) entfällt hier — es gibt
  keinen Agent, dessen Daten einzusetzen wären.

„Als Vorlage sichern" ist ein eigener Knopf im Editor, der den aktuellen Stand als
neue `ContractTemplate` mit `isDefault = false` anlegt.

### Dokument-Layout

`ContractDocumentData.agent` weicht einer allgemeineren Struktur:

```ts
interface ContractPartyView {
  side: 'INTERNAL' | 'EXTERNAL'
  partyName: string
  partyRole: string | null
  /// Nur bei Agent-Verträgen gesetzt; speist die Zeile unter dem Namen.
  agentLine: string | null
  signedAt: string | null
  signedName: string | null
}
```

Der Briefkopf zeigt bei `kind === 'AGENCY'` beide Behördennamen gegenüber, bei
`kind === 'AGENT'` unverändert Wappen und Agent-Daten. Die Unterschriftszeile
wird aus den Parteien erzeugt: zwei Blöcke nebeneinander statt einem. Der
Dienststempel erscheint erst, wenn **alle** Parteien unterschrieben haben.

Wasserzeichen, Wappen, §-Nummerierung, Blocksatz und Druck-CSS bleiben unangetastet
— das Dokument sieht bereits gut aus, es bekommt nur eine zweite Partei.

### Signaturablauf

`/vertrag/<token>` löst den Token künftig gegen `ContractSignature` statt gegen
`Contract` auf. Die Seite zeigt:

- das vollständige Dokument, inklusive der bereits geleisteten Unterschrift der
  Gegenseite, sofern vorhanden;
- die Felder, die dieser Partei zugeordnet sind;
- nach dem Unterschreiben den Hinweis, ob noch eine Unterschrift aussteht.

Eine interne Zeile mit `signerDiscordId` prüft weiterhin die Discord-Identität. Eine
externe Zeile hat keine — dort ist der Besitz des Links der Nachweis. Das ist eine
bewusste Abwägung und gehört in der Oberfläche benannt: **wer den Link hat, kann
unterschreiben.** Der Link ist entsprechend zu behandeln.

`POST /api/contract-links/<token>/sign` schreibt in die zugehörige Zeile und
aktualisiert danach den abgeleiteten Vertragsstatus.

### Oberfläche

`contracts-workspace.tsx` bekommt eine Umschaltung zwischen Personal- und
Behördenverträgen. Für Behördenverträge:

- „Neuer Behördenvertrag" öffnet den Editor mit leerem Dokument oder einer
  gewählten Vorlage als Start.
- Kopfdaten: Titel, eigene Vertretung, Name und Funktion der Gegenpartei.
- Je Partei ein Link zum Kopieren, samt Status („offen", „unterschrieben am …",
  „abgelehnt").
- „Als Vorlage sichern".

## Fehlerfälle

- **Token unbekannt oder Vertrag gelöscht** → dieselbe Seite wie heute für einen
  ungültigen Link, ohne Hinweis darauf, ob es den Vertrag je gab.
- **Bereits unterschrieben** → das Dokument wird angezeigt, das Formular nicht.
  Kein Fehler; erneutes Öffnen des Links ist der Normalfall.
- **Eine Partei lehnt ab** → Vertrag geht auf `DECLINED`; der Link der anderen
  Partei zeigt das Dokument nur noch an.
- **Vertrag zurückgezogen** (`CANCELLED`) → beide Links zeigen das Dokument ohne
  Formular.
- **Gleichzeitiges Unterschreiben beider Parteien** → jede Zeile wird einzeln
  geschrieben; der Statusabgleich läuft danach als eigene Abfrage, die alle Zeilen
  liest. Ein Wettlauf kann höchstens dazu führen, dass der Status einmal zu früh
  gelesen wird, nie dazu, dass eine Unterschrift verloren geht.
- **Agent wird gelöscht, Vertrag bleibt** → `agentId` wird `NULL`, das Dokument
  behält seinen Text, weil die Agent-Daten beim Anlegen bereits eingesetzt wurden.

## Tests

**Für das Vertragssystem existieren derzeit keine Tests** — `tests/` enthält
nichts zu Verträgen. Das ist der wichtigste Befund für die Planung: die
Absicherung, auf die der Umbau sich stützen soll, muss erst geschaffen werden.

Deshalb steht am Anfang ein Satz Charakterisierungstests, die das **heutige**
Verhalten festschreiben, bevor irgendetwas verschoben wird:

- Ein Vertrag entsteht aus einer Vorlage; Inhalt, Regelungen und Felder sind eine
  Kopie und ändern sich nicht mehr, wenn die Vorlage später bearbeitet wird.
- Platzhalter werden beim Anlegen aufgelöst, nicht beim Anzeigen.
- `loadContractByToken` weist einen Token mit abweichender Groß-/Kleinschreibung
  ab.
- Unterschreiben setzt Zeitpunkt, Name, IP und User-Agent und schaltet den Status
  auf `SIGNED`.
- Ein Vertrag mit `signerDiscordId` lässt nur diese Discord-Identität
  unterschreiben.

Diese Tests müssen vor der Migration grün sein und danach unverändert grün
bleiben — sie sind die Absicherung des Einstellungsverfahrens.
- Migration: ein Vertrag alten Zuschnitts erhält genau eine Signaturzeile mit
  unverändertem Token und unveränderten Signaturdaten.
- Zwei Parteien: der Vertrag wird erst `SIGNED`, wenn beide unterschrieben haben.
- Ablehnung einer Partei setzt den Vertrag auf `DECLINED`.
- Ein Token zeigt nur die Felder seiner eigenen Partei.
- Groß-/Kleinschreibung eines Tokens führt nicht auf eine fremde Signaturzeile
  (die vorhandene Prüfung in `loadContractByToken` wandert mit).
- Ein interner Unterzeichner ohne passende Discord-Identität wird abgewiesen.
- „Als Vorlage sichern" erzeugt eine Vorlage, die einen unveränderten neuen
  Vertrag erzeugt.

## Offene Punkte

Keine.

# Decknamen-System

Stand: 2026-09-08 · Status: implementiert; Datenbankbereitstellung und Namensfreigabe ausstehend.

Einrichtung und Verifikation: [Decknamen-System](../../codenames-setup.md).

## Ziel

Officer bekommen einen Decknamen („Agent Ghost"). Ein Katalog mit mehreren
tausend Namen bildet den Pool, aus dem zugewiesen wird. Ein Discord-Channel
zeigt dauerhaft, welcher Deckname aktuell zu welchem Officer gehört.
Decknamen lassen sich freigeben und neu zuweisen, die Historie bleibt erhalten.

Abgrenzung: Dies ist ein eigenständiges Modul. Es hat keine Abhängigkeit zum
Ermittlungssystem (`2026-09-07-ermittlungssystem-design.md`) außer, dass es
dessen Muster wiederverwendet.

## Datenmodell

```prisma
model Codename {
  id       String  @id @default(cuid())
  /// Der blanke Name ohne Präfix: "Ghost", nicht "Agent Ghost".
  name     String  @unique @db.VarChar(80)
  /// Thema für Filter und Auswahl: TIERE, WETTER, MINERALIEN, …
  category String? @db.VarChar(40)

  /// Aus dem Pool genommen (verbrannter Deckname, unpassender Name).
  /// Gesperrte Namen sind nicht zuweisbar, bleiben aber in der Historie.
  retired       Boolean @default(false)
  retiredReason String? @db.VarChar(200)

  /// Aktueller Träger. Nullable-Unique erzwingt beide Invarianten in EINER
  /// Bedingung: ein Deckname hat höchstens einen Träger (eine Spalte), und
  /// ein Agent hat höchstens einen Decknamen (unique). Viele NULLs sind in
  /// MySQL erlaubt — freie Decknamen kollidieren also nicht.
  currentAgentId String? @unique
  currentAgent   Agent?  @relation("CodenameCurrentHolder", fields: [currentAgentId], references: [id], onDelete: SetNull)

  createdById String?
  createdBy   User?    @relation("CodenameCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  assignments CodenameAssignment[]

  @@index([category])
  @@index([retired])
}

/// Historie. Die offene Zeile (releasedAt = null) gehört zu
/// `Codename.currentAgentId` — beide werden in derselben Transaktion gesetzt.
model CodenameAssignment {
  id         String @id @default(cuid())
  codenameId String
  codename   Codename @relation(fields: [codenameId], references: [id], onDelete: Cascade)
  agentId    String
  agent      Agent    @relation("CodenameAssignments", fields: [agentId], references: [id], onDelete: Cascade)

  assignedAt   DateTime  @default(now())
  releasedAt   DateTime?
  /// Warum freigegeben: MANUAL, REASSIGNED, TERMINATED, RETIRED
  releaseReason String?  @db.VarChar(40)
  note         String?   @db.Text

  assignedById String?
  assignedBy   User?   @relation("CodenameAssigner", fields: [assignedById], references: [id], onDelete: SetNull)
  releasedById String?
  releasedBy   User?   @relation("CodenameReleaser", fields: [releasedById], references: [id], onDelete: SetNull)

  @@index([codenameId, assignedAt])
  @@index([agentId, assignedAt])
  @@index([releasedAt])
}
```

Gegenfelder auf `Agent`:

```prisma
codename            Codename?            @relation("CodenameCurrentHolder")
codenameAssignments CodenameAssignment[] @relation("CodenameAssignments")
```

### Warum kein Status-Enum

Der Zustand eines Decknamens ist vollständig ableitbar:
`retired` → gesperrt, sonst `currentAgentId != null` → vergeben, sonst frei.
Ein zusätzliches Status-Feld wäre ein zweiter Ort für dieselbe Wahrheit und
würde früher oder später auseinanderlaufen. Filtern nach freien Decknamen ist
über `{ retired: false, currentAgentId: null }` indexgestützt und billig.

### Warum die Historie in einer eigenen Tabelle

„Neu zuweisen" heißt, dass ein Name den Träger wechselt. Bei einem Aliassystem
ist genau das die Information, die man später braucht: Wer war im Mai „Ghost"?
Ein einzelnes Feld auf `Agent` würde das verwerfen. Die Historie erlaubt
außerdem, einen verbrannten Decknamen zu sperren, statt ihn versehentlich neu
in den Pool zu geben.

## Katalog befüllen

- Datendatei `prisma/data/codenames.json`: `[{ "name": "Ghost", "category": "ABSTRAKT" }, …]`
- Seed-Skript `prisma/seed-codenames.ts`, aufrufbar über
  `npm run db:seed-codenames`. Muss **idempotent** sein
  (`createMany({ data, skipDuplicates: true })`), damit ein zweiter Lauf nichts
  zerstört und die Datei später erweitert werden kann.
- Zielgröße: 2.000–3.000 Namen. Kategorien als Vorschlag: `TIERE`, `WETTER`,
  `MINERALIEN`, `MYTHOLOGIE`, `HIMMELSKOERPER`, `WERKZEUGE`, `FARBEN`,
  `GEOGRAFIE`, `ABSTRAKT`.
- Das Präfix („Agent") wird **nicht** mitgespeichert, sondern beim Anzeigen
  ergänzt. Es steht als `SystemSetting` `codenames.prefix` (Default `"Agent"`),
  damit es später änderbar ist, ohne 3.000 Zeilen anzufassen. Ein Helfer
  `formatCodename(name)` in `src/lib/codenames.ts` ist die einzige Stelle, die
  das Präfix kennt.

## Zuweisungslogik

Der gesamte Kern liegt in `src/lib/codenames.ts`, nicht in den Routen — die
Routen validieren nur Eingaben und rufen auf.

**`assignCodename({ codenameId, agentId, actorId, force })`**, komplett in
`prisma.$transaction`:

1. Deckname `retired` → Fehler „Deckname ist gesperrt" (409).
2. Deckname hat bereits einen anderen Träger:
   - ohne `force` → Fehler 409 mit Nennung des aktuellen Trägers,
   - mit `force` → dessen offene Zuweisung schließen (`releaseReason: 'REASSIGNED'`).
3. Agent hat bereits einen anderen Decknamen → dessen offene Zuweisung
   schließen (`releaseReason: 'REASSIGNED'`) und `currentAgentId` dort auf
   `null` setzen. **Ohne diesen Schritt schlägt der Unique-Index zu** — genau
   dafür ist er da.
4. Neue `CodenameAssignment` anlegen, `Codename.currentAgentId` setzen.
5. Audit-Log, Discord-Board-Update anstoßen.

**`releaseCodename({ codenameId, actorId, reason, retire })`**: offene Zuweisung
schließen, `currentAgentId` auf `null`, optional `retired = true` setzen.

**Kündigung eines Agents**: Der bestehende Kündigungsablauf
(`src/app/api/terminations/…`) muss den Decknamen mit
`releaseReason: 'TERMINATED'` freigeben. Sonst blockiert ein ausgeschiedener
Officer dauerhaft einen Namen und steht weiter auf dem Discord-Board.

## Discord-Board

Vorbild ist eins zu eins `syncDiscordDutyStatusMessage` in
`src/lib/discord-integration.ts` (Zeile ~1940): eine dauerhafte Nachricht, die
bearbeitet statt neu gepostet wird. Der Channel bleibt dadurch ein Board und
keine Chronik.

Neue Werte in `DISCORD_SETTING_KEYS` und `DiscordConfig`:

- `codenameBoardChannelId` — Channel (auch als Env `DISCORD_CODENAME_BOARD_CHANNEL_ID`)
- `codenameBoardMessageIds` — **JSON-Array** von Message-IDs

### Warum ein Array

Discord begrenzt Components-v2-Textblöcke (im Repo als `MAX_TEXT_DISPLAY = 4000`
in `src/lib/discord-webhook.ts`). Eine Zeile kostet rund 45 Zeichen; ab etwa 80
Zuweisungen passt das Board nicht mehr in eine Nachricht. Deshalb:

- in Blöcke zu je 30 Einträgen aufteilen,
- vorhandene Nachrichten der Reihe nach per `PATCH` überschreiben,
- fehlende nachposten, überzählige löschen,
- die resultierende ID-Liste zurückschreiben.

Sortierung: alphabetisch nach Deckname. Pro Zeile: Deckname, Agent-Name,
Dienstnummer. Kopfzeile mit Anzahl und Zeitstempel über die vorhandenen
Helfer `markdownHeader` / `markdownRows` / `markdownMeta`.

Auslöser für `syncCodenameBoard()`: Zuweisung, Freigabe, Neuzuweisung,
Kündigung — jeweils als `queueCodenameBoardUpdate()` (fire-and-forget nach dem
Muster von `queueDiscordDutyStatusUpdate`, damit ein Discord-Ausfall nie den
API-Request scheitern lässt). Zusätzlich im bestehenden
`ensureDiscordSyncScheduler` als Sicherheitsnetz.

## Berechtigungen

In `src/lib/permissions.ts` ergänzen:

| Recht | Bedeutung |
| --- | --- |
| `codenames:view` | Katalog und Belegung ansehen |
| `codenames:manage` | Decknamen anlegen, zuweisen, freigeben, sperren |

`IMPLIED_PERMISSIONS`: `codenames:manage` → `['codenames:view', 'agents:view']`.

## API

```
GET    /api/codenames                 Katalog (Filter: search, status=free|assigned|retired, category)
POST   /api/codenames                 Einzelnen Decknamen anlegen
PATCH  /api/codenames/[id]            Name, Kategorie, retired ändern
DELETE /api/codenames/[id]            Löschen — nur wenn nie zugewiesen (sonst 409, stattdessen sperren)

POST   /api/codenames/[id]/assign     { agentId, note?, force? }
POST   /api/codenames/[id]/release    { retire?, note? }

GET    /api/codenames/assignments     Aktuelle Belegung (Board + Übersicht)
GET    /api/codenames/[id]/history    Trägerhistorie eines Decknamens
GET    /api/agents/[id]/codename      Aktueller Deckname + Historie eines Agents

POST   /api/codenames/board/sync      Board manuell neu aufbauen (settings:manage)
```

Fehlerbehandlung wie im Bestand: `requirePermission`, `try/catch` auf
`Unauthorized`/`Forbidden`, Antworten über `src/lib/api-response.ts`. Für die
Ermittlungsrouten existiert dafür bereits `routeError` in
`src/lib/investigations-server.ts` — dasselbe Muster hier lokal wiederholen
oder den Helfer in ein gemeinsames Modul heben.

## UI

- **`/codenames`** — Katalog: Suche, Filter (frei / vergeben / gesperrt,
  Kategorie), Zuweisen-Dialog. Bei mehreren tausend Einträgen **serverseitig
  paginieren**, nicht alles laden.
- **Belegungsliste** — aktuell vergebene Decknamen mit Agent, als eigener Tab.
  Spiegelt, was im Discord-Channel steht.
- **Agent-Detailseite** — aktueller Deckname plus Historie.
- **Sidebar** — Eintrag „Decknamen" unter `codenames:view`
  (`src/components/layout/sidebar.tsx`, `mainNav`).

Für die Agentenauswahl im Zuweisen-Dialog lässt sich
`src/components/investigations/agent-picker.tsx` wiederverwenden; er ist aktuell
auf Mehrfachauswahl ausgelegt und braucht eine Einzelauswahl-Variante.

## Audit

`createAuditLog` bei jeder schreibenden Aktion, mit `agentId` wo vorhanden:
`CODENAME_CREATED`, `CODENAME_UPDATED`, `CODENAME_DELETED`, `CODENAME_RETIRED`,
`CODENAME_ASSIGNED`, `CODENAME_RELEASED`, `CODENAME_REASSIGNED`.

## Zu klären vor der Umsetzung

1. **Sichtbarkeit.** Der Discord-Channel macht die Zuordnung im ganzen Verbund
   öffentlich. Falls Decknamen vertraulich sein sollen, braucht es stattdessen
   einen rollenbeschränkten Channel und ein `codenames:classified`-Recht.
   Der Spec geht bis auf Weiteres von „intern öffentlich" aus.
2. **Wiederverwendung.** Darf ein freigegebener Deckname sofort erneut vergeben
   werden, oder erst nach einer Sperrfrist? Aktuell: sofort, Sperren nur manuell.
3. **Ein Deckname pro Agent.** Der Unique-Index setzt das hart durch. Falls
   jemand mehrere Decknamen gleichzeitig führen soll, muss das Modell anders
   aussehen — das ist keine spätere Kleinigkeit, sondern der Kern des Entwurfs.
4. **Namensliste.** Die 2.000–3.000 Namen muss jemand liefern oder freigeben.
   Das ist inhaltliche Arbeit, keine Programmierung.

## Aufwandsschätzung

| Teil | Aufwand |
| --- | --- |
| Schema, Migration, Seed-Skript | 0,5 Tag |
| `src/lib/codenames.ts` inkl. Transaktionslogik | 0,5 Tag |
| API-Routen | 0,5 Tag |
| Discord-Board inkl. Aufteilung auf mehrere Nachrichten | 0,5–1 Tag |
| UI (Katalog, Belegung, Agent-Detail, Sidebar) | 1–1,5 Tage |
| Kündigungs-Hook, Audit, Berechtigungen | 0,5 Tag |

Summe rund **3,5 bis 4,5 Tage**, ohne das Zusammenstellen der Namensliste.

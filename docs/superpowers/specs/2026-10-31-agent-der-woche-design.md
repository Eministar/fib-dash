# Agent der Woche – Ranking mit Wochenbewertung

Stand: 2026-10-31 · Status: umgesetzt (Nutzer: „fang direkt an“) – Betriebsdoku: `docs/agent-der-woche-setup.md`

## Worum es geht

Berechtigte Nutzer bewerten **einmal pro Woche jeden Agent** in vier Kategorien, jeweils 1–10:

| Kategorie | Emoji |
|---|---|
| Schießen | 🎯 |
| Allgemeine Arbeit | 🗂️ |
| Aktivität | ⚡ |
| RP-Künste | 🎭 |

Aus den Bewertungen entsteht ein **Ranking** mit Gesamtwertung und den vier Unterkategorien. Der Agent mit dem besten Durchschnitt der Woche erhält den Titel **Agent der Woche**. Das Ranking steht auf einer eigenen Seite im Dashboard und als gestaltetes Board (keine Tabelle) in einem Discord-Kanal.

**„Agent des Monats“ wird ersetzt.** Die bisherige Monatsabstimmung (Dashboard-Karte, API, Abstimmungslogik) entfällt; der Agent der Woche bekommt eine eigene Seite statt einer Dashboard-Karte.

## Ziele

- Seite im Dashboard: Ranking der laufenden Woche, Bewertungsmaske, Verlauf aller bisherigen Agents der Woche.
- Discord-Board im Stil der bestehenden Bot-Meldungen (Components V2), automatisch aktuell gehalten.
- Wöchentlicher Titel „Agent der Woche“, sichtbar auf der Seite, im Discord-Board, beim Agent (Erfolge) und optional als Discord-Rolle.
- Agent des Monats sauber entfernen.

## Nicht-Ziele

- Keine Freitext-Kommentare zu Bewertungen.
- Keine Belohnungen/Beförderungen, die automatisch aus dem Ranking folgen.
- Keine Änderung in der Desktop-App.
- Keine Bewertung über Discord-Buttons/Slash-Commands – bewertet wird nur im Dashboard.

## Anti-Ziele (wäre ein Fehlschlag, selbst wenn es technisch läuft)

- Das Discord-Board sieht aus wie eine Tabelle / ein Textblock statt wie die abgestimmten Karten.
- Einzelne Bewerter können sehen, wer wem welche Note gegeben hat (Bewertungen sollen ehrlich bleiben).
- Jemand kann sich selbst bewerten oder einen Agent in derselben Woche mehrfach werten.

## Abgestimmtes Discord-Design (vom Nutzer gewählt: „B, aber mehrere Agents pro Karte“)

Komponenten über die vorhandenen Helfer in `src/lib/discord/discord-components.ts` (`container`, `textDisplay`, `separator`, `linkButton`, `markdownTitle`, `iconLine`, …).

1. **Goldene Karte „Agent der Woche“** (Container mit goldener Akzentfarbe, z. B. `0xF0B232`):
   - Titel `` `🏆` Agent der Woche ``, darunter **Name**, Dienstnummer, Kalenderwoche, Gesamt `8,7 / 10`.
   - Vier Zeilen, je Kategorie: `` `🎯` › Schießen ▰▰▰▰▰▰▰▰▰▱ **9,1** `` (10-teiliger Balken, gerundet auf ganze Stufen; Wert mit einer Nachkommastelle, deutsches Komma).
   - Anzahl der Bewertungen.
2. **Ranking-Karten** (Container ohne Akzent) mit **mehreren Agents pro Karte**, getrennt durch Trennlinien:
   - Kopf `` `📊` › Ranking KW 44 · Plätze 2–4 `` (Folgekarten „Plätze 5–7“ usw.).
   - Je Agent: `🥈`/`🥉`/`4.` …, **Name**, Gesamt **x,x**; darunter zwei Zeilen mit je zwei Kategorien als Emoji + kurzer Balken + Wert.
3. Letzte Karte: Legende (`🎯 Schießen · 🗂️ Allg. Arbeit · ⚡ Aktivität · 🎭 RP-Künste`) und Link-Button „Zum Ranking“ auf die Dashboard-Seite.

Wie viele Agents pro Karte und Karten pro Nachricht passen, entscheidet der Builder anhand der Discord-Limits (Components V2: max. 40 Komponenten, 4000 Zeichen Text je Nachricht). Reicht eine Nachricht nicht, wird auf mehrere Bot-Nachrichten verteilt – genau wie beim Decknamen-Board (`codenameBoardMessageIds`).

Referenz-Mockup: liegt nur lokal in der Brainstorming-Session; die obige Beschreibung ist maßgeblich.

## Wochenablauf

- **Woche** = ISO-Kalenderwoche Montag 00:00 bis Sonntag 23:59 in `Europe/Berlin`. Schlüssel z. B. `2026-W44` (analog `monthKey` in `agent-of-month.ts`, das als Vorlage für die reine Hilfsdatei dient).
- **Wer bewertet:** Nutzer mit Recht `ranking:rate` **und** verknüpftem Agent (`Agent.userId`). Ohne verknüpften Agent keine Bewertung (wie bisher beim Agent des Monats).
- **Wer bewertet wird:** alle Agents mit Status `ACTIVE` oder `AWAY` (kurz abgemeldet); nicht `ON_LEAVE` (beurlaubt), `INACTIVE`, `TERMINATED`. Nie der eigene Agent.
- **Eine Bewertung je (Woche, Bewerter, Agent)** mit vier ganzzahligen Werten 1–10. Bis zum Wochenende änderbar (Upsert), danach gesperrt.
- **Fortschritt:** Die Bewertungsmaske zeigt „x von y Agents bewertet“; die Erwartung ist, dass jeder Bewerter alle Agents wertet, erzwungen wird es nicht.
- **Berechnung:** je Agent und Kategorie der Mittelwert aller Bewertungen der Woche; **Gesamt = Mittelwert der vier Kategorie-Mittelwerte**. Agents ohne Bewertung erscheinen nicht im Ranking.
- **Agent der Woche** = höchste Gesamtwertung einer **abgeschlossenen** Woche. Gleichstand → mehrere Agents der Woche (wie `monthWinners`).
- Die Gewinner werden wie beim Agent des Monats **beim Lesen aus den Bewertungen berechnet**; eine eigene Ergebnis-Tabelle ist nicht nötig, außer der Builder braucht sie für den Rollenwechsel (s. u.).

### Was das Board/die Seite wann zeigt

- Goldene Karte: Agent der Woche der **zuletzt abgeschlossenen** Woche (der Titel wird erst am Wochenende vergeben).
- Ranking-Karten: **Live-Stand der laufenden Woche**.
- Noch keine abgeschlossene Woche / keine Bewertungen → freundlicher Leerzustand statt leerer Karte.

## Dashboard-Seite

Eigener Menüpunkt **„Agent der Woche“** unter `/agent-der-woche` (Sidebar in `src/components/layout/sidebar.tsx`, Icon z. B. Trophy). Drei Bereiche (Tabs o. ä.), Gestaltung im Stil des bestehenden Dashboards:

1. **Ranking** – dieselbe Logik wie das Board: oben Agent der Woche (letzte Woche) hervorgehoben, darunter die laufende Woche mit Platz, Gesamt und vier Balken je Agent.
2. **Bewerten** (nur mit `ranking:rate`) – Liste aller bewertbaren Agents, je Agent vier Eingaben 1–10 (z. B. Zahlenreihe oder Slider), eigene bereits abgegebene Werte vorausgefüllt, Fortschrittsanzeige, Speichern je Agent.
3. **Verlauf** – alle bisherigen Agents der Woche (KW, Name, Gesamt, Unterwerte), neueste zuerst.

Einzelbewertungen (wer hat wem was gegeben) sieht nur `ranking:manage`; alle anderen sehen nur Durchschnitte und die Anzahl der Bewertungen.

## Rechte

Neu in `src/lib/permissions.ts` (mit deutscher Beschriftung, wie die anderen Rechte):

- `ranking:view` – Seite und Ranking sehen.
- `ranking:rate` – bewerten.
- `ranking:manage` – Einzelbewertungen einsehen und einzelne Bewertungen löschen (Missbrauch).

API-Routen prüfen serverseitig wie die übrigen Routen (`requireAuth`/Permission-Helfer aus `src/lib/auth.ts`).

## Discord-Anbindung

- Neue Einstellungen analog zum Decknamen-Board in `discord-integration.ts` und unter **Einstellungen → Discord** (`admin/settings/page.tsx`):
  - `rankingBoardChannelId` (+ optionale Env-Variable `DISCORD_RANKING_BOARD_CHANNEL_ID` mit Vorrang), `rankingBoardMessageIds`, Fingerprint-Key.
  - `agentOfWeekRoleId` (optional): leer = keine Rolle.
- **Aktualisierung:** nach jeder gespeicherten/gelöschten Bewertung (über eine serialisierende Queue wie `syncDiscordCodenameBoard`), zusätzlich per Intervall (z. B. alle 5 Min.), damit der Wochenwechsel ohne neue Bewertung erkannt wird. Fingerprint verhindert unnötige Edits.
- **Rolle:** Beim Wochenwechsel bekommen die neuen Agents der Woche die Rolle, die vorherigen verlieren sie. Muss idempotent sein und Neustarts überstehen (z. B. zuletzt vergebene Woche/Agent-IDs als Setting speichern).

## Agent des Monats entfernen

Entfällt:
- `src/components/dashboard/agent-of-month-card.tsx` und die Einbindung in `src/components/dashboard/overview.tsx`.
- `src/app/api/agent-of-month/route.ts`.
- Abstimmungsfunktionen in `src/lib/agents/agent-of-month-server.ts` / `agent-of-month.ts` sowie `tests/agent-of-month-db.test.ts` und die Monats-Teile von `tests/achievements.test.ts`.

Erfolge (`src/lib/agents/achievements.ts`, `api/agents/[id]/achievements`): „Agent des Monats“ wird durch **„Agent der Woche“** (`n× Agent der Woche`, Beschreibung = Liste der KWs, Stufen nach Anzahl) ersetzt.

**Bestehende Daten:** Das Prisma-Modell `AgentOfMonthVote` und seine Relationen bleiben vorerst im Schema, damit `npm run db:push` auf der Produktionsdatenbank keine Tabelle löscht. Alte Monatssiege werden nicht mehr angezeigt. *(Annahme – siehe „Entscheidungen“.)*

## Datenmodell (Vorschlag)

```prisma
model AgentWeeklyRating {
  id        String   @id @default(cuid())
  /// ISO-Woche "YYYY-Www" (Europe/Berlin)
  week      String   @db.VarChar(8)
  raterId   String   // User
  agentId   String   // bewerteter Agent
  shooting  Int      // 1–10
  work      Int
  activity  Int
  roleplay  Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([week, raterId, agentId])
  @@index([week, agentId])
}
```

Relationen zu `User` und `Agent` mit `onDelete: Cascade` wie bei `AgentOfMonthVote`. Schema-Änderung per `npm run db:push`.

## Rahmenbedingungen

- **Next.js-Version weicht ab:** vor dem Schreiben die Doku in `node_modules/next/dist/docs/` lesen (siehe `AGENTS.md`).
- **Lokale `.env` zeigt auf die Produktionsdatenbank und den echten Bot.** Kein `next dev` mit aktivem Bot, keine schreibenden DB-Tests ohne Rückfrage beim Nutzer. Reine Funktionen (Wochenschlüssel, Durchschnitt, Gewinner, Board-Aufteilung) mit `npx tsx --test` testen.
- **Nichts committen oder pushen** – das macht der Nutzer selbst.
- Code-Stil: deutsche Kommentare/Texte, Muster der vorhandenen Module (`agent-of-month*.ts`, Decknamen-Board) übernehmen.
- Setup-Doku als `docs/agent-der-woche-setup.md` im Stil von `docs/corruption-checks-setup.md`.

## Nachträge bei der Umsetzung (überschreiben Abweichendes oben)

- Rechte heißen `agent-of-week:view|rate|manage` statt `ranking:*`; niemand hat sie automatisch.
- Ergebnisse werden beim Wochenwechsel in `AgentWeeklyResult` eingefroren (statt beim Lesen berechnet).
- Titel nur mit mindestens halb so vielen Bewertungen wie der meistbewertete Agent der Woche.
- Ranking-Karten im Board beginnen bei Platz 1 (Live-Woche); die goldene Karte zeigt den Titelträger der Vorwoche.
- Löschen durch `manage` nur in der laufenden Woche.
- Discord-Rolle über `Agent.discordId`.
- Erfolgsstufen: 1× Bronze, ab 2× Silber, ab 5× Gold.

## Entscheidungen, die ich (Claude) getroffen habe – bitte prüfen

- Woche = Mo–So, Europe/Berlin.
- Bewertet werden `ACTIVE` und `AWAY`, nicht Beurlaubte.
- Gesamt = Mittel der vier Kategorie-Mittel (alle Kategorien gleich gewichtet).
- Gleichstand → mehrere Agents der Woche.
- Goldene Karte zeigt die letzte abgeschlossene Woche, Ranking die laufende.
- Einzelbewertungen sind anonym, nur `ranking:manage` sieht sie.
- Bewertet werden kann nur mit verknüpftem Agent; man kann sich nicht selbst bewerten.
- Optionale Discord-Rolle für den Agent der Woche.
- Alte Agent-des-Monats-Daten bleiben in der DB, werden aber nicht mehr angezeigt.

## Dem Builder überlassen

- Genaue UI-Komponenten der Seite und der Bewertungseingabe.
- Aufteilung Agents pro Karte / Nachrichten innerhalb der Discord-Limits.
- Ob für den Rollenwechsel ein kleines Ergebnis-/Setting-Feld gespeichert wird.
- Namen der Dateien/Funktionen, solange sie zum bestehenden Muster passen.

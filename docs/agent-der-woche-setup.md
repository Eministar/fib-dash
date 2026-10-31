# Agent der Woche

Eigener Menüpunkt **Agent der Woche** unter `/agent-der-woche` (Bereich „Personal“). Ersetzt den früheren „Agent des Monats“ samt Dashboard-Karte.

## Ablauf

- Jede **ISO-Kalenderwoche** (Montag 00:00 bis Sonntag 23:59, deutsche Zeit) bewerten Berechtigte jeden Agent in vier Kategorien mit 1–10: 🎯 Schießen, 🗂️ Allgemeine Arbeit, ⚡ Aktivität, 🎭 RP-Künste.
- Bewertet werden Agents mit Status *Aktiv* oder *Abgemeldet*, nicht Beurlaubte, Inaktive oder Gekündigte. Niemand kann sich selbst bewerten. Bewerten geht nur mit einem Benutzerkonto, das mit einem Agent verknüpft ist.
- Je Bewerter und Agent gibt es eine Bewertung pro Woche. Sie lässt sich bis Sonntag 23:59 ändern.
- **Gesamt** = Durchschnitt der vier Kategorie-Durchschnitte (alle gleich gewichtet).
- **Agent der Woche** wird, wer nach Wochenende die höchste Gesamtnote hat **und** mindestens halb so viele Bewertungen wie der meistbewertete Agent dieser Woche. Bei Gleichstand teilen sich mehrere den Titel.
- Beim Wochenwechsel wird das Ergebnis eingefroren (Tabelle `AgentWeeklyResult`, mit Namen als Momentaufnahme). Spätere Status- oder Namensänderungen verschieben alte Wochen nicht.
- Siege erscheinen in der Personalakte als Erfolg „Agent der Woche“ (Bronze 1×, Silber ab 2×, Gold ab 5×).

## Seite

- **Ranking:** oben der Agent der Woche der letzten abgeschlossenen Woche, darunter das Live-Ranking der laufenden Woche mit Gesamtnote und den vier Kategorien.
- **Bewerten:** alle bewertbaren Agents mit je vier Notenleisten 1–10 und einer Fortschrittsanzeige („x von y bewertet“).
- **Verlauf:** alle bisherigen Agents der Woche.

Einzelbewertungen sind anonym. Nur `agent-of-week:manage` sieht, wer wem welche Note gegeben hat. Dieses Recht darf Bewertungen der **laufenden** Woche löschen (mit Audit-Eintrag). Abgeschlossene Wochen lassen sich nicht ändern.

## Rechte

Unter **Benutzergruppen** (oder per Discord-Rollen-Rechte) vergeben. Ohne Vergabe sieht niemand die Seite:

| Recht | Wirkung |
|---|---|
| `agent-of-week:view` | Seite und Ranking ansehen |
| `agent-of-week:rate` | Agents wöchentlich bewerten (enthält *view*) |
| `agent-of-week:manage` | Einzelbewertungen einsehen und löschen (enthält *view*) |

## Discord

Unter **Einstellungen → Discord**:

- **Agent-der-Woche-Board** (Gruppe „Boards & Clips“): Kanal für das Board. Oben steht eine goldene Karte mit dem Agent der Woche, darunter das Live-Ranking mit drei Agents je Karte und Balken pro Kategorie, unten ein Link zur Seite. Bei vielen Agents verteilt sich das Board auf mehrere Bot-Nachrichten. Es wird nach jeder Bewertung und alle 5 Minuten aktualisiert, aber nur bearbeitet, wenn sich etwas geändert hat. Leer lassen, um es abzuschalten. `DISCORD_AGENT_OF_WEEK_BOARD_CHANNEL_ID` hat Vorrang.
- **Agent-der-Woche-Rolle** (Abschnitt „Rollen“): optional. Der Bot gibt sie beim Wochenwechsel dem neuen Titelträger (über die Discord-ID des Agents) und nimmt sie dem vorherigen. `DISCORD_AGENT_OF_WEEK_ROLE_ID` hat Vorrang.
- Auf der Seite gibt es für `settings:manage` den Knopf **Board aktualisieren**. Er schließt offene Wochen ab, gleicht die Rolle ab und schreibt das Board neu.

Wochenabschluss, Rollenwechsel und Board laufen im Hintergrund alle 5 Minuten (`ensureAgentOfWeekScheduler` in `src/instrumentation.ts`). Im lokalen Dev-Modus ist das wie alle Hintergrund-Jobs aus.

## Datenbank und Bereitstellung

Neue Tabellen `AgentWeeklyRating` und `AgentWeeklyResult`. Vor dem Start der neuen Version mit `npm run db:push` abgleichen (sichert vorher die Datenbank). Die alte Tabelle `AgentOfMonthVote` bleibt bewusst im Schema, damit `db:push` keine Daten löscht. Sie wird nicht mehr gelesen und kann später gezielt entfernt werden.

## Prüfung

`npx tsx --test tests/agent-of-week.test.ts tests/achievements.test.ts` prüft Wochenschlüssel (Zeitzone, Jahreswechsel), Durchschnitt, Mindestanzahl, Gleichstand, Bewertungsregeln sowie Aufbau und Discord-Limits des Boards.

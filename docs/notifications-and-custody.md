# Benachrichtigungen, Netzwerk und Beweiskette

## Was neu ist

- **Glocke (oben rechts neben der Suche):** persönliche Benachrichtigungen der letzten 30 Tage. Ausgelöst bei Zuweisung zu einer Ermittlung, neuer Fallführung, durchgeführter Rangänderung, neuer Rangänderungsliste (an alle mit `rank-changes:view`), Probezeit-Ende in ≤ 3 Tagen (Agent + Ersteller) und Asservat-Übergabe an einen Agent. Eigene Aktionen erzeugen keine Benachrichtigung für einen selbst.
- **Strg+K-Aktionen:** „Ermittlung/Person/Fahrzeug anlegen“, „Abmeldung eintragen“, „Sanktion ausstellen …“, „Abmeldung für Agent …“, „Personalakte öffnen …“ (Aktion wählen, dann Agent suchen; Rücktaste geht zurück). Beim ersten Agent-Treffer erscheinen die passenden Aktionen direkt darunter.
- **Treffer über Fälle hinweg:** Beim Anlegen von Personen und Fahrzeugen erscheint „Bereits erfasst“, wenn Name, Alias, Kennung, Telefon bzw. Kennzeichen schon bekannt sind. In der Akte zeigt jede Person / jedes Fahrzeug „Auch in N weiteren Akten“. Verschlusssachen ohne Zugriff werden nicht mitgezählt.
- **Zeitstrahl:** neuer Reiter in der Akte mit Einträgen, Clips, Asservaten, Bildern und Übergaben; nach Tag gruppiert, filterbar. `≈` markiert Zeitpunkte, die nur aus der Erfassung stammen.
- **Netzwerk:** `Ermittlungen → Netzwerk` bzw. Knopf „Netzwerk“ in Akte, Personen- und Fahrzeugakte. 1–3 Schritte um einen Ausgangspunkt, max. 150 Knoten.
- **Beweiskette:** Knopf „Beweiskette“ an jedem Asservat. Erfassen, Bearbeiten, Statuswechsel, Übergaben, Einsehen und Löschen werden unveränderlich protokolliert und per SHA-256 verkettet. „Als PDF exportieren“ öffnet die Druckansicht `/investigations/evidence/<id>/custody`.

## Bereitstellung

1. Datenbank sichern.
2. `npm run db:push` **oder** einmalig `prisma/patches/2026-10-01-notifications-custody.sql` anwenden (nur neue Tabellen, nicht beides).
3. `npm run build`, Server neu starten.

Asservate, die vor dem Update erfasst wurden, haben keinen Kettenanfang. Ihre Kette beginnt mit dem ersten Ereignis nach dem Update.

## Tests

`npx tsx --test tests/notifications.test.ts tests/palette-actions.test.ts tests/cross-hits.test.ts tests/case-timeline.test.ts tests/custody-chain.test.ts tests/link-graph.test.ts` – reine Logik ohne Datenbank. Ein Live-Test gegen eine Datenbank steht noch aus.

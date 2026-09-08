# Korruptionskontrollen

Eigenständiger Hauptmenüpunkt **Korruptionskontrollen** unter `/corruption-checks`. Alle angemeldeten Dashboard-Nutzer können Beamtenakten und Kontrollberichte einsehen sowie Kontrollen eintragen. Es sind keine Internal-Affairs-, Ermittlungs- oder Agent-Verwaltungsrechte erforderlich. Nicht angemeldete Zugriffe auf die APIs werden abgewiesen.

## Bedienung

- **Kontrolle eintragen → Neuer Staatsbeamter:** Vorname, Nachname, Behörde und optional Dienstnummer erfassen. Bei der ersten erfolgreich gespeicherten Kontrolle entsteht die Beamtenakte mit ihrer festen Nummer, zum Beispiel `BEA-000001`.
- **Bestehende Beamtenakte:** Nach Nummer (auch ohne Präfix), Vorname/Nachname oder Dienstnummer suchen und im Dropdown auswählen. Gleichnamige Personen werden anhand Nummer, Behörde und optional Dienstnummer unterschieden; die Neuanlage zeigt mögliche vorhandene Akten zur Auswahl an.
- Datum und Uhrzeit werden in der lokalen Browserzeitzone eingegeben und als UTC gespeichert. Mindestens einen durchführenden Agent auswählen; mehrere sind möglich. Ausgeschiedene Agents bleiben für nachträgliche Einträge auswählbar.
- Ergebnis **Mit Befund** verlangt eine Beschreibung. **Ohne Befund** kann mit zusätzlichen Feststellungen ergänzt werden. Ort und weitere Informationen sind optional.
- Das **Kontrollarchiv** enthält alle Kontrollen, mit Suche und kombinierbaren Filtern für Behörde, Zeitraum (Enddatum eingeschlossen), Ergebnis und Agent. Sortierung ist nach Datum auf- oder absteigend möglich. Es gibt 25 Ergebnisse pro Seite.
- Unter **Beamtenakten** eine Akte öffnen, um deren vollständige Kontrollhistorie zu durchsuchen oder direkt eine weitere Kontrolle einzutragen.

Beamtenakte, Kontrolle, Agent-Snapshots und Audit-Eintrag werden in einer Transaktion gespeichert. Nummern entstehen über den Datenbank-Auto-Inkrementzähler, nicht über die Anzahl vorhandener Akten; Lücken nach abgebrochenen Transaktionen sind möglich. Wiederholte Übertragungen desselben Formulars verwenden eine eindeutige Anfragekennung und erzeugen keine Doppelkontrolle. Verschiedene Nutzer können bewusst separate Akten für gleichnamige Personen anlegen.

Namen und Dienstnummern der durchführenden Agents bleiben als Momentaufnahme erhalten, auch wenn der Agent später umbenannt oder gelöscht wird. Das Modul bietet kein Löschen oder nachträgliches Überschreiben der Kontrollberichte.

## Datenbank und Bereitstellung

Vor dem Start der neuen Version die Datenbank sichern und mit `npm run db:push` erweitern. Alternativ den additiven Patch `prisma/patches/2026-09-08-corruption-checks.sql` einmalig auf den vorherigen Schema-Stand anwenden. Die beiden Wege nicht kombinieren. Anschließend `npm run build` und Server neu starten.

Der Patch wurde lokal generiert, nicht auf einer produktiven Datenbank ausgeführt. Die bestehenden Personenakten und Agent-Personalakten werden nicht verändert.

## Prüfung

`npx tsx --test tests/corruption-checks.test.ts` prüft Erstkontrolle, Wiederverwendung einer Beamtenakte, mehrere Agent-Snapshots, wiederholte Anfragen, ungültige Referenzen, Datum/Befund-Validierung und Nummern-/Namenssuche. Die Transaktionsfunktionen werden mit einem Datenbank-Doppel geprüft; echte MariaDB-Rollbacks und parallele Anfragen benötigen einen Integrationstest mit einer Testdatenbank.

Nach Bereitstellung mit einem gewöhnlichen Dashboard-Konto prüfen: Erstkontrolle anlegen, Nummer notieren, zweite Kontrolle derselben Akte zuordnen und Archivfilter kombinieren.

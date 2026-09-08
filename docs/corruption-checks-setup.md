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

Namen und Dienstnummern der durchführenden Agents bleiben als Momentaufnahme erhalten, auch wenn der Agent später umbenannt oder gelöscht wird. Das Modul bietet kein Löschen von Kontrollberichten.

## Zusammenführen, Korrigieren und Beweise

- In einer Beamtenakte **Doppelte Akte zusammenführen** wählen, Zielakte suchen und eine Begründung eintragen. Die Vorschau zeigt Quelle und Ziel. Die Stammdaten des Ziels bleiben bestehen; sämtliche Kontrollen werden übernommen. Alte Nummern und Namen sind weiterhin suchbar und führen zur gemeinsamen Akte. Die Zusammenführung wird im Audit protokolliert. Gleichzeitige Änderungen werden durch eine serialisierbare Transaktion geschützt.
- Im Bericht **Bericht korrigieren** öffnen. Datum/Uhrzeit, Ort, Agents, Befund und weitere Informationen können mit Begründung korrigiert werden. Jede Korrektur speichert eine neue Version mit vollständiger Vorher-/Nachher-Fassung, Bearbeitername und Zeitpunkt. Veraltete Bearbeitungsstände werden mit einem Konflikt abgewiesen. Historische Agent-Namen bleiben erhalten.
- Im Bericht unter **Beweise** Bilder (JPG, PNG, GIF, WebP), PDFs oder Videos (MP4, WebM, MOV) hochladen, maximal 500 MB je Datei. Beweisanlagen liegen privat unter `<UPLOAD_DIR>/corruption-evidence`; sie sind für angemeldete Dashboard-Nutzer sichtbar. PDFs werden heruntergeladen. Diese Original-Beweisanlagen werden nicht automatisch neu komprimiert.
- Nutzer mit Bodycam-Zugriff können vorhandene Clips direkt verknüpfen. Die Rechte der ursprünglichen Aufnahme werden bei jedem Aufruf erneut geprüft; die Verknüpfung gibt keine zusätzlichen Rechte. Wird der ursprüngliche Clip gelöscht, ist die Verknüpfung nicht mehr abspielbar.

Die Erweiterung benötigt den zusätzlichen Patch `prisma/patches/2026-09-08-corruption-extensions.sql` oder einen Schema-Abgleich mit `npm run db:push` (vorher sichern). Patches nicht zusätzlich zu einem bereits ausgeführten Schema-Abgleich anwenden.

## Bodycam-Zugriff über Discord

Unter **Einstellungen → Discord → Bodycam-Katalog: Discord-Rolle für Lesezugriff** die gewünschte Rolle auswählen. Alternativ `DISCORD_BODYCAM_VIEWER_ROLE_ID` setzen; die Umgebungsvariable hat Vorrang. Die Rolle wird serverseitig anhand des Discord-Kontos der angemeldeten Person geprüft. Bei fehlender Mitgliedschaft oder fehlgeschlagener Rollenprüfung wird kein zusätzlicher Zugriff gewährt.

Die Rolle schaltet den **Bodycam-Katalog** in der Hauptnavigation frei und erlaubt Lesen/Abspielen nicht vertraulicher Clips. Sie gewährt keine Bearbeitungsrechte und keinen allgemeinen Zugriff auf Ermittlungsakten. Bestehende Ermittlungsrechte gelten weiterhin. API-Token erhalten über diese Rolle keine erweiterten Rechte. Es werden weder eine Discord-Rolle erstellt noch Mitglieder automatisch hinzugefügt.

## Datenbank und Bereitstellung

Vor dem Start der neuen Version die Datenbank sichern und mit `npm run db:push` erweitern. Alternativ den additiven Patch `prisma/patches/2026-09-08-corruption-checks.sql` einmalig auf den vorherigen Schema-Stand anwenden. Die beiden Wege nicht kombinieren. Anschließend `npm run build` und Server neu starten.

Der Patch wurde lokal generiert, nicht auf einer produktiven Datenbank ausgeführt. Die bestehenden Personenakten und Agent-Personalakten werden nicht verändert.

## Prüfung

`npx tsx --test tests/corruption-checks.test.ts` prüft Erstkontrolle, Wiederverwendung einer Beamtenakte, mehrere Agent-Snapshots, wiederholte Anfragen, ungültige Referenzen, Datum/Befund-Validierung und Nummern-/Namenssuche. Die Transaktionsfunktionen werden mit einem Datenbank-Doppel geprüft; echte MariaDB-Rollbacks und parallele Anfragen benötigen einen Integrationstest mit einer Testdatenbank.

Nach Bereitstellung mit einem gewöhnlichen Dashboard-Konto prüfen: Erstkontrolle anlegen, Nummer notieren, zweite Kontrolle derselben Akte zuordnen und Archivfilter kombinieren.

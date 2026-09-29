# Dashboard-Bereinigung

## Gestaltung

Bestehende FIB-Farbwelt beibehalten: Hintergrund #181818, Flächen #1b1b1b, Trennlinien #343434, Haupttext #f4f4f4, Nebentext #a6a6a6. Die vorhandene Systemschrift bleibt; Seitenüberschriften 22–24 px, Navigation 13–14 px. Links bündig ausgerichtete Arbeitsbereiche, kompakte Reiternavigation, Statusfarben nur als unterstützende Information. Keine neue Schmuckschrift, keine zusätzliche Hero-Grafik. Die Übersicht verliert Hintergrundlichter, Einblendanimationen und doppelte Detailauswertungen.

## Module und Zuordnung

| Bereich | Entscheidung |
| --- | --- |
| Dashboard / Statistik | Ein Einstieg, Ansichten Übersicht und Statistiken. Rangverteilung und ausführlicher Ausbildungsstand nur in der Statistik. |
| Kalender | Aus der Hauptnavigation entfernt; Unit-Kalender bleiben der reguläre Einstieg. Bestehende globale Termine und direkte Links bleiben unter /calendar erreichbar, damit Einträge ohne Unit nicht verschwinden. |
| Ermittlungen / Bodycams / Personen / Fahrzeuge / Bilder / Dauerakten / Freigaben | Gemeinsamer Ermittlungsbereich; kein zweiter Bodycam-Link für Ermittler. Konten mit ausschließlich Bodycam-Leserechten behalten ihren Einstieg. |
| Sanktionen / Katalog | Sanktionen und Nachschlagewerk als Ansichten desselben Bereichs; alte Katalog-URL leitet weiter. |
| Agents / Decknamen / Rangänderungen / Kündigungen | In der aufklappbaren Personalgruppe. Eigene Berechtigungen und spezialisierte Bearbeitungsabläufe bleiben erhalten. |
| Dienstzeiten | Beim Arbeitsplatz; aktives Ein-/Ausstempeln ist eine eigenständige Funktion. |
| Notizen | Beim Arbeitsplatz; von verbindlichen Ordnungen und Unit-Dokumenten getrennt. |
| Ordnungen / Uploads | Gemeinsame Gruppe Unterlagen. Verbindliche Vorschriften und Dateiablage bleiben unterscheidbar. |
| HR | Bewerbungen, Arbeitsverträge, Versetzungen, Probezeiten, Tests, Aufgaben und Kalender bleiben unter HR. Werkzeuge werden erst beim Aufruf geladen. |
| Vereinbarungen | Externe Verträge heißen in der Navigation Vereinbarungen; HR-Verträge heißen Arbeitsverträge. Unterschiedliche Vertragsprozesse werden nicht vermischt. |
| Academy | Ausbildungsunterlagen, Ressourcen, Tests, Aufgaben und Kalender bleiben innerhalb der Academy; Inhalte werden bedarfsweise geladen. |
| S.R.U. | Dokumentstruktur und eigene Aufgaben bleiben erhalten; Aufgabenwerkzeug wird bedarfsweise geladen. |
| Detective / Air Support / Press | Gemeinsamer ModuleWorkspace lädt Dokumente, Aufgaben und Kalender erst bei Auswahl. |
| Internal Affairs | Dokumente und Durchsuchungen bleiben fachlich getrennte Ansichten; beide laden bedarfsweise. |
| Legal Affairs | Rechtsdokumente und Klagen bleiben getrennte Ansichten; beide laden bedarfsweise. |
| Individuelle Units | Bestehende, berechtigungsgefilterte Navigation bleibt erhalten. |
| Korruptionskontrollen / Karte | Unter Ermittlungen & Disziplin eingeordnet; eigene Berichte bzw. geografische Ansicht bleiben erhalten. |
| Ermittlungsgruppen | Leadership-Zugriff unverändert; kein Zusammenlegen mit Aktenberechtigungen. |
| Ränge / Ausbildungen / Units / Benutzer / Gruppen / API-Tokens / Exporte / Einstellungen / Protokoll | In der aufklappbaren Administration; Protokoll aus der Hauptnavigation dorthin verschoben. |
| Konto / Build-Historie | Im Kontobereich; keine Vermischung mit operativen Aufgaben. |
| Öffentliche Formulare / Signaturlinks / Bewerberportal | Keine Änderung; eigenständige Zugriffs- und Unterschriftsabläufe. |

## Last und Verhalten

- Hintergrundabfragen standardmäßig alle 30 statt 5 Sekunden (zwei statt zwölf Intervallabfragen pro Minute und Hook).
- Navigation alle 120 Sekunden; aktive Tests behalten das 5-Sekunden-Intervall.
- Fokus-, Sichtbarkeits- und Live-Ereignisse lösen weiterhin Aktualisierungen aus; parallele Hintergrundabfragen desselben Hooks werden vermieden.
- Veraltete Antworten nach URL-Wechsel oder Unmount werden verworfen.
- Agenten für das Abmeldeformular erst beim Öffnen abrufen.
- Navigation lädt nicht vorsorglich sämtliche verlinkten Bereiche.
- Keine gemessene Aussage zur Ende-zu-Ende-Ladezeit; dafür ist eine angemeldete Sitzung mit repräsentativen Daten erforderlich.

## Discord

Personalereignisse verwenden einen kompakten Titel, strukturierte Details, Trennlinien, einen Statusakzent und eine kurze Angabe von Bearbeiter und Zeitpunkt. Begrüßung, doppelte Einleitung und Grußformel entfallen. Das Abmeldepanel zeigt Rückkehrdatum und Restzeit. Interaktions-IDs sowie explizite Erwähnungen bleiben erhalten. Es wurden keine Discord-Nachrichten zum Test versendet.

Technische Referenz für Container und Statusakzente: https://docs.discord.com/developers/components/reference#container

# Freigabelinks für Akten und Bodycams

Unter **Ermittlungen → Freigabelinks** lassen sich Links für eine gezielte Auswahl an Dauerakten/Unterakten, Einzel-/Einsatzakten, Personenakten, Fahrzeugakten und Bodycams erstellen. Jeder Link kann bis zu 100 Einträge aus mehreren Bereichen enthalten.

## Bedienung

1. **Link erstellen**, Bezeichnung vergeben und optional ein Ablaufdatum wählen.
2. Über die Bereichsauswahl suchen und die gewünschten Einträge anhaken. Die Liste „ausgewählt“ zeigt die gesamte Freigabe. Nicht angehakte Einträge bleiben gesperrt.
3. Link erstellen und sofort kopieren. Der geheime Link wird nur einmal angezeigt; die Datenbank speichert lediglich seinen SHA-256-Hash.
4. **Auswahl bearbeiten** ergänzt/entfernt Einträge auf demselben Link und ändert Ablaufdatum oder Aktiv-Status. **Link deaktivieren** sperrt ihn. **Link ersetzen** erzeugt einen neuen geheimen Link und macht den alten ungültig; eine Bestätigung im Dialog erläutert diesen Schritt.

Die öffentliche Leseansicht liegt unter `/share/records/<token>` außerhalb des Dashboard-Layouts. Ein Dashboard-Konto ist nicht erforderlich. Es gibt dort keine Bearbeitungsfunktionen.

## Umfang der Freigabe

- **Dauerakte:** Titel, Kategorie, Adresse, Informationen und zugeordnetes Katalogfoto.
- **Einzel-/Einsatzakte:** Titel, Aktenzeichen, Status, Zusammenfassung und Chronologie mit Texten und Zeitpunkten.
- **Personenakte:** Nummer, Name, Alias, Kennung, Geburtsdatum, Telefon, Fahndungs-/Gefahrenstatus, Notizen und Katalogfoto.
- **Fahrzeugakte:** Nummer, Modell, Kennzeichen, Farbe, Status und Notizen.
- **Bodycam:** Titel, Beschreibung, Ort, Zeitpunkt, Dauer und geschützter Video-Stream mit Spulfunktion.

Verknüpfte Personen, Fahrzeuge, Bodycams, andere Akten und Unterakten werden **nicht automatisch freigegeben**. Sie müssen zusätzlich einzeln ausgewählt werden. Interne Benutzerkennungen, Speicherpfade und nicht ausgewählte Verknüpfungen werden nicht ausgegeben. Fotos werden nur aus dem internen Bildkatalog bereitgestellt; alte externe Foto-URLs werden nicht eingebunden. Freitexte und Chronologie werden als Text dargestellt.

Die Auswahl veröffentlicht den aktuellen Stand der Akten. Änderungen an deren Inhalten sind daher auch über den Link sichtbar. Bei einer nachträglichen Einstufung als Verschlusssache wird der betroffene Eintrag ausgeblendet, wenn er ursprünglich als nicht vertraulich freigegeben wurde. Bereits bei Erstellung ausdrücklich gewählte Verschlusssachen werden im Editor gekennzeichnet und sind Teil der Freigabe.

## Rechte und Widerruf

Verwalten erfordert `investigations:manage`. Nutzer sehen und verwalten ihre eigenen Freigaben; Nutzer mit `settings:manage` können alle Freigaben verwalten. Bei jeder Auswahl werden Existenz und bisherige Ermittlungs-Zugriffsrechte serverseitig geprüft. Veraltete Bearbeitungsstände führen zu einem Konflikt statt zum Überschreiben neuerer Änderungen.

Jeder öffentliche API-Aufruf – auch Bilder und Video-Range-Requests – prüft Token, Aktiv-Status, Ablaufdatum und die explizite Auswahl. Die Antworten sind `no-store`, `noindex` und verwenden `no-referrer`. Bereits empfangene oder heruntergeladene Inhalte lassen sich durch Deaktivieren nicht zurückholen; weitere Abrufe werden gesperrt.

## Bereitstellung und Tests

Vor Deployment Datenbank sichern und `npm run db:push` ausführen. Alternativ den additiven Patch `prisma/patches/2026-09-08-record-shares.sql` einmalig anwenden. Der Patch setzt die vorherigen Module voraus und enthält nur die Freigabetabellen. Nicht beide Wege kombinieren. Anschließend `npm run build` und Server neu starten.

`npx tsx --test tests/record-shares.test.ts` prüft Ablauf/Widerruf/Tokenwechsel, Auswahlgrenzen, Schutz vor Zugriff auf fremde IDs und Unterakten, sichere Ausgabe ohne verknüpfte Daten, Foto-Zugriffe sowie Eingabevalidierung. Der lokale Test verwendet Datenbank-Doubles; ein Live-Test mit Datenbank und Browser ist nach Bereitstellung erforderlich. Es wurden keine produktiven Freigabelinks erzeugt.

# Ermittlungen: Medien und Dauerakten

## Bereitstellung

1. Datenbank und persistente Uploads sichern (`npm run db:backup` sichert die Datenbank).
2. Vor dem Start der neuen Version `npm run db:push` ausführen. Alternativ den geprüften SQL-Patch `prisma/patches/2026-09-08-investigation-media-dossiers.sql` einmalig auf den bisherigen Schema-Stand anwenden. Nicht beide Wege kombinieren.
3. `npm run build` und Server neu starten. Die SQL-Datei wurde nur erzeugt, nicht auf eine Datenbank angewendet.
4. `UPLOAD_DIR` und gegebenenfalls `CLIP_DIR` müssen persistent sein. Alle App-Instanzen benötigen denselben Dateispeicher.

## Bodycam-Komprimierung

Neue und vorhandene Clips werden automatisch in einer Datenbank-Warteschlange verarbeitet. Pro Serverprozess läuft eine Konvertierung gleichzeitig. Standard: WebM, AV1 (libsvtav1), Opus mit 64 kbit/s pro Tonspur, maximal 1280 × 720 und 30 fps, CRF 36. Kleine Videos werden nicht hochskaliert. Die Komprimierung ist verlustbehaftet; höhere CRF-Werte sparen mehr Platz, verlieren aber mehr Details. Eine feste Ersparnis lässt sich nicht vorhersagen.

FFmpeg und ffprobe müssen im PATH liegen; alternativ `FFMPEG_PATH` und `FFPROBE_PATH` setzen. FFmpeg benötigt libsvtav1 und libopus. Das Docker-Image installiert FFmpeg. `CLIP_VIDEO_CODEC=vp9` nutzt libvpx-vp9 als Alternative für breitere Browserunterstützung. AV1 kann insbesondere auf älteren Apple-Geräten nicht im Browser abspielbar sein.

Ein Original wird erst nach Prüfung von Laufzeit, Tonspuranzahl, vollständiger Dekodierung und Dateigröße ersetzt. Größere Ergebnisse, HDR-Videos und fehlgeschlagene Konvertierungen behalten das Original. Nach erfolgreicher Datenbankumschaltung wird das Original entfernt; fehlgeschlagene Dateibereinigung wird erneut versucht. Beim Konvertieren ist vorübergehend Platz für beide Dateien nötig. Der Player zeigt Status und Ersparnis an.

Abgebrochene Verarbeitungen werden nach fünf Minuten ohne Lebenszeichen wieder aufgenommen. `FAILED` wird nicht endlos wiederholt: nach Behebung der Ursache kann ein Administrator gezielt betroffene Datensätze zurück auf `PENDING` setzen. Fehlende FFmpeg-Encoder stoppen die Warteschlange, ohne alle Clips als fehlgeschlagen zu markieren.

`CLIP_COMPRESSION_ENABLED=false` verhindert neue Konvertierungen. Ein bereits laufender Auftrag wird dadurch nicht abgebrochen. Weitere Grenzen stehen in `.env.example`.

## Discord-Bildkatalog

Unter **Einstellungen → Discord → Bildkatalog-Channel** den von euch angelegten Textchannel wählen. Alternativ `DISCORD_PHOTO_CATALOG_CHANNEL_ID` setzen (hat Vorrang). Der konfigurierte Bot benötigt Zugriff auf den Channel und die Berechtigung, den Nachrichtenverlauf zu lesen. Im Discord Developer Portal muss **Message Content Intent** aktiviert sein, damit die Nachrichten-Attachments verfügbar sind.

Der Server fragt etwa jede Minute neue Nachrichten ab. Vorhandene Nachrichten werden schrittweise nachgeladen (100 pro Seite); größere Rückstände benötigen mehrere Durchläufe. Unter **Ermittlungen → Bildkatalog → Jetzt abgleichen** kann ein Einstellungsadministrator einen Durchlauf auslösen. `PHOTO_CATALOG_SYNC_ENABLED=false` schaltet nur die automatische Abfrage aus.

Unterstützt werden hochgeladene JPG-, PNG-, WebP- und GIF-Anhänge bis 20 MB. Der Nachrichtentext dient als Beschriftung, sonst der Dateiname. Externe Webseitenlinks und SVG-Dateien werden nicht importiert. Dateien werden dauerhaft unter `<UPLOAD_DIR>/investigation-photos` gespeichert und über eine geschützte Dashboard-Route bereitgestellt; ablaufende Discord-Links beeinträchtigen die gespeicherten Fotos nicht. Das Löschen einer Discord-Nachricht entfernt bereits importierte Fotos nicht. Sichtbar sind die Fotos für Nutzer mit `investigations:view`.

In einer **Personenakte unter Ermittlungen** lässt sich das Foto direkt aus dem Bildkatalog auswählen oder entfernen. Eigene Agent-Personalakten sind davon unabhängig.

## Dauerakten

**Ermittlungen → Dauerakten** bietet die festen Kategorien Familienakte, Sammelakte, Anwesen und Unterakte. Jede Akte hat Titel, Informationen, Adresse/Standort und ein optionales Katalogfoto. Personen bzw. Familienmitglieder und zugängliche Einsatzakten lassen sich verknüpfen.

Über **Unterakte hinzufügen** können beispielsweise Anwesen und einzelne Sachverhalte einer Familien- oder Sammelakte untergeordnet werden. Beim Bearbeiten kann die übergeordnete Akte geändert werden. Zyklen werden serverseitig verhindert. Verknüpfte Dauerakten erscheinen auch in der jeweiligen Personenakte.

Lesen erfordert `investigations:view`, Anlegen/Bearbeiten `investigations:manage`, Löschen `investigations:delete`. Eine Akte mit Unterakten kann erst gelöscht werden, nachdem diese verschoben oder entfernt wurden. Verknüpfte Personen und Einsatzakten bleiben bestehen. Vertrauliche Einsatzakten werden anhand der bestehenden Ermittlungsberechtigungen gefiltert.

## Prüfung

`npx tsx --test tests/clip-transcode.test.ts tests/investigation-media.test.ts` prüft echte Videokonvertierung, Laufzeit/Ton/Größe, Hochformat, ungültige Videos, Aktenzyklen, Eingabegrenzen und die URL-/Dateitypgrenzen des Bildimports. Die Videotests benötigen FFmpeg. Vor dem Produktiveinsatz mit einer Testdatenbank einen Discord-Bildupload, die Fotoauswahl und das Anlegen/Verschieben einer Unterakte durchspielen; ein Live-Discord-Abgleich ist nicht Teil der lokalen Tests.

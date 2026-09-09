# Chunked Uploads für alle Dateiwege

Stand: 2026-09-09

## Problem

Bodycam-Clips bis 500 MiB gehen heute als ein einziger, langer HTTP-Request auf
die Reise. Das ist aus vier Gründen unbefriedigend:

- **Zuverlässigkeit.** Jeder Abbruch — WLAN-Aussetzer, Reload, Server-Neustart —
  wirft die gesamte Übertragung weg. Bei 400 MB ist das teuer.
- **Geschwindigkeit.** Ein einzelner Stream lastet eine Leitung mit spürbarer
  Latenz nicht aus.
- **Fremde Limits.** Jeder Proxy auf dem Weg (nginx, Cloudflare, ein CDN) hat ein
  eigenes Maximum für die Request-Größe. Ein zu kleines Limit lässt den Upload im
  Browser einfrieren, ohne Fehlermeldung — genau das ist in der Produktion
  passiert, weil `scripts/server-setup.sh` die Site mit `client_max_body_size 25M`
  angelegt hat.
- **Rückmeldung.** Der Dialog zeigt einen Prozentbalken, sonst nichts. Keine Rate,
  keine Restzeit, kein Fortsetzen.

## Ziel

Ein gemeinsamer, wiederaufnehmbarer Upload-Weg für **alle** vier Dateiwege des
Dashboards: Bodycam-Clips, Asservate der Korruptionsprüfung, Ermittlungsfotos und
Akademie-Ressourcen. Jeder einzelne Request bleibt klein genug, dass kein
vorgeschaltetes Größenlimit ihn je wieder blockiert.

## Nicht-Ziele

- Kein Objektspeicher (S3 o. ä.). Die Dateien liegen weiterhin auf lokaler Platte
  unter `uploadDir()`; Auslieferung, Zugriffsschutz und die ffmpeg-Komprimierung
  bleiben unverändert.
- Keine Komprimierung im Browser vor dem Upload.
- Kein Weiterreichen laufender Uploads zwischen verschiedenen Nutzern oder Geräten.

## Architektur im Überblick

Der Upload zerfällt in zwei getrennte Verantwortungen:

1. **Transport** — ein generischer Dienst unter `/api/uploads`, der Bytes
   entgegennimmt, prüft und zu einer fertigen Datei zusammensetzt. Er weiß nichts
   über Ermittlungsakten oder Asservate.
2. **Fachlichkeit** — die bestehenden Routen (`/api/investigations/clips` usw.).
   Sie bekommen künftig nur noch JSON-Metadaten plus eine Referenz auf die fertig
   geprüfte Datei und behalten ihre gesamte Logik: Rechte, Validierung,
   Audit-Log, Discord-Meldung.

Die Kopplung zwischen beiden ist ein **Upload-Ticket**: die ID einer
abgeschlossenen Sitzung. Sie ist an den Nutzer gebunden, genau einmal einlösbar
und trägt die Art der Datei mit sich.

Damit verschwindet nebenbei der `x-clip-meta`-Header, über den heute
base64-kodiertes JSON reist, weil der Request-Body für die Videodaten gebraucht
wird. Die Metadaten wandern in einen ganz normalen JSON-Body.

## Datenmodell

Ein neues Prisma-Modell `UploadSession` (MySQL, cuid wie überall sonst):

| Feld | Typ | Zweck |
|---|---|---|
| `id` | `String @id @default(cuid())` | Zugleich das Upload-Ticket |
| `kind` | `VarChar(20)` | `CLIP` \| `EVIDENCE` \| `PHOTO` \| `RESOURCE` |
| `ownerId` | `String` | Ersteller; nur er darf anhängen, abschließen, einlösen |
| `fingerprint` | `VarChar(120)` | Aus Dateiname, Größe und Änderungsdatum. Findet eine angefangene Sitzung wieder |
| `originalName` | `VarChar(255)` | Für den späteren Datensatz |
| `mimeType` | `VarChar(120)` | Deklaration des Clients, beim Abschluss gegen die Bytes geprüft |
| `totalBytes` | `BigInt` | Erwartete Gesamtgröße |
| `chunkSize` | `Int` | Serverseitig festgelegt, nicht vom Client wählbar |
| `chunkCount` | `Int` | Abgeleitet aus `totalBytes` und `chunkSize` |
| `status` | `VarChar(20)` | `OPEN` \| `ASSEMBLING` \| `DONE` \| `CONSUMED` \| `FAILED` |
| `assembleStartedAt` | `DateTime?` | Heartbeat des Zusammensetzens, analog `compressionStartedAt` |
| `storedFilename` | `VarChar(80)?` | Ergebnisdatei nach dem Zusammensetzen |
| `sha256` | `VarChar(64)?` | Über die zusammengesetzte Datei, serverseitig berechnet |
| `error` | `VarChar(300)?` | Grund bei `FAILED`, für die Anzeige im Dialog |
| `expiresAt` | `DateTime` | Anlage + 24 h |
| `createdAt`, `updatedAt` | | |

Indizes: `[ownerId, fingerprint, status]` für die Wiederaufnahme,
`[status, expiresAt]` für den Aufräum-Job.

### Fortschritt steht bewusst nicht in der Datenbank

Jeder Chunk landet als eigene Datei unter
`uploadDir()/incoming/<sessionId>/<index>.part`. Geschrieben wird zunächst nach
`<index>.tmp`; erst wenn Größe und Prüfsumme stimmen, folgt ein `rename` auf den
endgültigen Namen. Ein `.part` existiert also ausschließlich für vollständige,
verifizierte Chunks.

Das ist die tragende Entscheidung für die parallele Übertragung: mehrere Chunks
gleichzeitig schreiben **verschiedene Dateien** und fassen nie dieselbe
Datenbankzeile an. Es gibt keinen Read-Modify-Write auf einer Bitmaske und damit
keine verlorenen Updates. Wiederaufnahme heißt: Ordner auflisten, vorhandene
Indizes melden, den Rest senden.

Die naheliegende Alternative — eine Zeile pro Chunk in einer `UploadChunk`-Tabelle
mit `@@unique([sessionId, index])` — funktioniert ebenfalls und wäre gegen
doppelte Zustellung idempotent. Sie erzeugt aber bis zu 64 Zeilen pro Upload für
eine Information, die das Dateisystem ohnehin schon hält.

## Protokoll

Alle Endpunkte verlangen eine Anmeldung. Die nötige Berechtigung hängt am `kind`
und ist dieselbe, die heute die jeweilige fachliche Route prüft.

### `POST /api/uploads`

Legt eine Sitzung an oder findet eine bestehende wieder.

```jsonc
// Anfrage
{ "kind": "CLIP", "originalName": "zugriff.mp4", "mimeType": "video/mp4",
  "totalBytes": 214958080, "fingerprint": "zugriff.mp4:214958080:1757320145000" }

// Antwort
{ "sessionId": "clx…", "chunkSize": 8388608, "chunkCount": 26,
  "received": [0, 1, 2, 3] }
```

Existiert für dieselbe Kombination aus `ownerId`, `kind` und `fingerprint` bereits
eine Sitzung mit Status `OPEN`, wird **sie** zurückgegeben statt einer neuen —
inklusive der bereits empfangenen Indizes. Genau darin besteht das Fortsetzen; es
braucht dafür keinen Zustand im Browser.

`chunkSize` und `chunkCount` legt der Server fest. Weicht `totalBytes` bei einer
wiedergefundenen Sitzung ab, wird die alte verworfen und neu begonnen — die Datei
hat sich dann geändert.

### `PUT /api/uploads/:id/chunks/:index`

Rohbody, ein Chunk. Header `x-chunk-sha256` trägt die Prüfsumme, die der Browser
über genau diesen Abschnitt gebildet hat.

Der Server prüft: Sitzung gehört dem Anfragenden, Status ist `OPEN`,
`0 ≤ index < chunkCount`, die empfangene Länge entspricht `chunkSize` (beim
letzten Chunk dem Rest), und die Prüfsumme stimmt. Erst dann das `rename`.
Antwort: `{ "received": 5, "chunkCount": 26 }`.

Ein bereits vorhandener Index wird ohne Fehler bestätigt — doppelte Zustellung
nach einem Wiederholversuch ist damit unschädlich.

### `POST /api/uploads/:id/complete`

Setzt die Chunks in aufsteigender Reihenfolge zu einer Datei zusammen und prüft
dabei in einem Durchlauf:

- Sind alle `chunkCount` Teile vorhanden?
- Ergibt die Summe genau `totalBytes`?
- Passen die ersten Bytes zu einem für dieses `kind` erlaubten Format?
- SHA-256 über das Ganze, wird gespeichert.

Der Statusübergang `OPEN → ASSEMBLING` läuft als Compare-and-Swap, damit zwei
gleichzeitige Aufrufe (oder zwei Serverinstanzen) nicht beide zusammensetzen —
dasselbe Muster, das `compressNextClip()` in `src/lib/clip-compression.ts` bereits
für die Komprimierung verwendet. Danach `ASSEMBLING → DONE`, der `incoming`-Ordner
wird gelöscht.

Antwort: `{ "sessionId": "clx…", "sizeBytes": 214958080, "mimeType": "video/mp4",
"sha256": "…" }`.

### `DELETE /api/uploads/:id`

Bricht ab, löscht Zeile und Teildateien.

### Einlösen in der fachlichen Route

`POST /api/investigations/clips` nimmt künftig JSON entgegen:

```jsonc
{ "uploadId": "clx…", "investigationId": "…", "title": "Zugriff Tankstelle", … }
```

Die Route prüft: Sitzung gehört dem Anfragenden, `status === "DONE"`, `kind`
passt zur Route. Sie verschiebt die fertige Datei in ihr Zielverzeichnis, legt den
Datensatz an und setzt die Sitzung im selben Zug auf `CONSUMED`. Ein Ticket lässt
sich damit nicht zweimal einlösen.

Analog für Asservate, Fotos und Akademie-Ressourcen.

## Aufteilung und Parallelität

- **Chunk-Größe** 8 MiB, über `UPLOAD_CHUNK_BYTES` konfigurierbar. Klein genug
  für jedes realistische Proxy-Limit, groß genug, dass der Verwaltungsaufwand pro
  Chunk nicht ins Gewicht fällt: eine 400-MB-Datei ergibt rund 48 Requests.
- **Parallelität** 3 gleichzeitige Chunks, über `UPLOAD_CONCURRENCY`
  konfigurierbar. Das ist der Punkt, an dem der Durchsatz auf Leitungen mit
  Latenz deutlich über dem eines einzelnen Streams liegt.
- **Kleine Dateien** gehen denselben Weg mit `chunkCount = 1`. Es gibt bewusst
  keinen zweiten Codepfad für „klein"; ein Foto kostet dann drei Requests statt
  einem, was bei Bilddateien nicht messbar ist.

## Sicherheit

- **Sitzung fest am Nutzer.** Jeder Endpunkt vergleicht `session.ownerId` mit dem
  angemeldeten Nutzer und prüft zusätzlich die fachliche Berechtigung des `kind`.
  Fremde Sitzungen antworten mit 404, nicht 403 — die Existenz einer fremden
  Sitzung ist keine Information, die wir preisgeben müssen.
- **Prüfsumme je Chunk.** Der Browser bildet SHA-256 über jeden Chunk mit
  `crypto.subtle.digest`; bei 8 MiB ist das nativ und schnell. Der Server rechnet
  nach und verwirft bei Abweichung.

  Ein SHA-256 über die **ganze** Datei kann der Browser nicht sinnvoll bilden —
  `crypto.subtle.digest` braucht den vollständigen Puffer im Speicher, und eine
  JS-Implementierung dauert bei 400 MB zig Sekunden. Vollständigkeit und
  Reihenfolge sichern stattdessen Chunk-Index, `chunkCount` und der Abgleich der
  Gesamtgröße ab; den Gesamt-Hash berechnet der Server beim Zusammensetzen.
- **Echte Formatprüfung.** Beim Zusammensetzen werden die ersten Bytes gegen die
  für das `kind` erlaubten Signaturen geprüft, statt dem `Content-Type` des
  Clients zu glauben. Heute könnte jemand eine beliebige Datei als `video/mp4`
  deklarieren.

  Einschränkung, die im Code als Kommentar festgehalten gehört: WebM und MKV
  teilen sich die EBML-Signatur `1A 45 DF A3` und sind an dieser Stelle nicht
  unterscheidbar. Geprüft wird deshalb gegen die erlaubte **Signaturgruppe** des
  `kind`, nicht auf exakte Übereinstimmung mit dem deklarierten MIME-Typ. Das
  weist fremde Formate ab; es unterscheidet nicht zwei erlaubte Containerformate
  voneinander.
- **Schutz vor voller Platte.** Höchstens 3 offene Sitzungen je Nutzer und eine
  Obergrenze für deren summierte `totalBytes`. Darüber hinaus antwortet
  `POST /api/uploads` mit 429 und einer verständlichen Meldung.
- **Pfadsicherheit.** Session-IDs und Chunk-Indizes werden wie die vorhandenen
  Dateinamen validiert, bevor sie in einen Pfad wandern — dasselbe Muster wie
  `isStoredClipFilename` / `resolveClipPath`.

## Aufräumen

Der bestehende Intervall-Worker in `src/lib/clip-compression.ts` bekommt einen
zweiten Auftrag:

- Sitzungen mit `expiresAt < jetzt` und Status `OPEN` oder `FAILED`: Zeile und
  `incoming`-Ordner löschen.
- Sitzungen in `ASSEMBLING`, deren `assembleStartedAt` älter als 5 Minuten ist:
  Lease ist abgelaufen, Zusammensetzen erneut versuchen. Dieselbe Logik und
  dieselbe Frist wie bei der Komprimierung.
- Verwaiste `incoming`-Ordner ohne zugehörige Zeile: löschen.
- `DONE`-Sitzungen, die nach 24 h niemand eingelöst hat: Datei und Zeile löschen.

## Fehlerbehandlung im Browser

`src/lib/chunked-upload.ts` kapselt den gesamten Ablauf in einer
framework-freien Funktion:

```ts
uploadInChunks(file, kind, { onProgress, signal }): Promise<UploadTicket>
```

- Ein fehlgeschlagener Chunk wird bis zu dreimal wiederholt, mit wachsendem
  Abstand. Erst danach scheitert der Gesamtvorgang.
- `onProgress` liefert übertragene Bytes, Rate und geschätzte Restzeit. Der
  Fortschritt zählt bestätigte Chunks plus die laufenden Teilfortschritte — anders
  als heute, wo der Balken die Bytes im Socket-Puffer zeigt und deshalb bei einem
  hängenden Upload fälschlich weiterläuft.
- `signal` bricht ab und ruft `DELETE`.
- Findet `POST /api/uploads` eine angefangene Sitzung, meldet die Funktion das
  über `onProgress`, damit der Dialog „Fortsetzen bei 42 %" anzeigen kann.

Der Upload-Dialog zeigt künftig Rate und Restzeit, den Hinweis auf eine
fortgesetzte Übertragung und die konkrete Fehlermeldung des gescheiterten Chunks.

## Auswirkungen auf bestehenden Code

- `src/proxy.ts:55` schließt heute die beiden Rohbody-Routen vom Body-klonenden
  Proxy aus. Die Ausnahme wandert auf `/api/uploads/:id/chunks/:index`; die
  fachlichen Routen brauchen sie nicht mehr, weil ihre Bodys jetzt klein sind.
- `saveClipStream`, `saveEvidence` und `savePhotoUpload` verlieren ihre
  Stream-Aufgabe. Sie werden zu einer gemeinsamen Funktion, die eine bereits
  geprüfte Datei ins Zielverzeichnis übernimmt.
- Die Header `x-clip-meta`, `x-evidence-title`, `x-photo-title` und
  `x-upload-size` entfallen; entsprechend auch ihre Einträge in
  `src/lib/upload-cors.ts`.
- Akademie-Ressourcen wechseln von `multipart/form-data` auf denselben Weg.
- Die alten Rohbody-Pfade werden **entfernt**, nicht parallel weiterbetrieben.
  Client und Server werden gemeinsam ausgerollt; ein Übergangsmodus wäre
  zusätzlicher Code ohne Nutzen.
- Die nginx-Korrektur aus `scripts/fix-nginx-uploads.sh` bleibt bestehen. Sie ist
  nach diesem Umbau nicht mehr nötig, schadet aber nicht und schützt den Fall,
  dass jemand einen Chunk größer konfiguriert.

## Tests

Neu, `tests/chunked-uploads.test.ts`, gegen einen echten lokalen HTTP-Server —
dasselbe Vorgehen wie in `tests/large-uploads.test.ts`:

- 200 MiB in Chunks, parallel und in vertauschter Reihenfolge gesendet; die
  zusammengesetzte Datei stimmt in Größe und SHA-256 mit der Quelle überein.
- Abbruch bei etwa der Hälfte, neue Sitzungsanfrage liefert die bereits
  empfangenen Indizes, der fortgesetzte Upload ergibt dieselbe Prüfsumme.
- Ein Chunk mit falscher Prüfsumme wird abgelehnt und hinterlässt kein `.part`.
- Ein Chunk mit falscher Länge wird abgelehnt.
- Doppelt gesendeter Chunk wird ohne Fehler bestätigt.
- Ein fremder Nutzer bekommt auf jede Operation an der Sitzung 404.
- Eine Datei mit unpassenden Magic Bytes scheitert beim Abschließen.
- Ein Ticket lässt sich nicht zweimal einlösen.
- Kontingent: die vierte gleichzeitige Sitzung wird abgelehnt.
- Der Aufräum-Job entfernt abgelaufene Sitzungen samt Ordner und nimmt ein
  hängengebliebenes `ASSEMBLING` wieder auf.

`tests/large-uploads.test.ts` bleibt bestehen, soweit es die Dateischreiber prüft.

## Offene Punkte

Keine. Die Formatprüfung ist bewusst auf Signaturgruppen begrenzt (siehe
Sicherheit); das ist eine getroffene Entscheidung, keine offene Frage.

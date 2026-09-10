# Upload-API

Eigenständige Schnittstelle, um Dateien ins Dashboard zu laden — Ticket-Transkripte,
Screenshots, Dokumente. Sie hat nichts mit dem Ermittlungssystem, Bodycam-Clips oder
Asservaten zu tun und braucht weder einen Dashboard-Account noch Permissions: es genügt
ein Upload-Schlüssel.

Hochgeladene Dateien erscheinen im Dashboard unter **Uploads** (`/uploads`), inklusive
Vorschau, Beschreibung und Metadaten.

## Schlüssel besorgen

Unter `/uploads/keys` (Recht `uploads:manage`) legst du einen Schlüssel an. Er sieht so aus:

```
fibup_4kQ8xZ2mNpR7vB1cLdF6hJ3wS9tY0aE5uI8oP2gK4nM
```

Der Klartext wird **einmal** angezeigt und danach nur noch als SHA-256-Hash gespeichert.
Geht er verloren, legst du einen neuen an und widerrufst den alten. Ein Schlüssel kann
widerrufen werden (bleibt sichtbar, funktioniert nicht mehr) oder ein Ablaufdatum haben.

## Datei hochladen

```
POST /api/files
Content-Type: multipart/form-data
X-Upload-Key: fibup_…
```

Alternativ `Authorization: Bearer fibup_…`, falls dein Client keine eigenen Header setzen kann.

### Felder

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `file` | ja | Die Datei selbst |
| `title` | nein | Titel im Dashboard. Leer = Dateiname |
| `description` | nein | Freitext, bis 10 000 Zeichen |
| `category` | nein | z. B. `Ticket-Transkript`. Leer = Standard-Kategorie des Schlüssels |
| `tags` | nein | Kommagetrennt (`ticket,support`) oder das Feld mehrfach senden |
| `externalRef` | nein | Referenz im Fremdsystem, z. B. die Ticketnummer |
| `externalUrl` | nein | Link zurück ins Fremdsystem (muss eine gültige URL sein) |
| `externalUser` | nein | Wer dort hochgeladen hat (freier Text) |
| `metadata` | nein | JSON-Objekt als String; erscheint im Dashboard als Schlüssel/Wert-Tabelle |

### Beispiel

```bash
curl -X POST https://nerovfib.de/api/files \
  -H "X-Upload-Key: fibup_…" \
  -F "file=@ticket-1234.html" \
  -F "title=Ticket #1234 — Beschwerde Streifendienst" \
  -F "category=Ticket-Transkript" \
  -F "externalRef=1234" \
  -F "externalUrl=https://ticketboard.example/tickets/1234" \
  -F "externalUser=Max Mustermann" \
  -F "tags=ticket,beschwerde" \
  -F 'metadata={"kanal":"support","geschlossen_am":"2026-09-10"}'
```

Aus JavaScript:

```js
const form = new FormData()
form.append('file', new Blob([transkriptHtml], { type: 'text/html' }), `ticket-${id}.html`)
form.append('title', `Ticket #${id}`)
form.append('category', 'Ticket-Transkript')
form.append('externalRef', String(id))
form.append('metadata', JSON.stringify({ kanal, geschlossenAm }))

const res = await fetch('https://nerovfib.de/api/files', {
  method: 'POST',
  headers: { 'X-Upload-Key': process.env.FIB_UPLOAD_KEY },
  body: form,
})
```

### Antwort

`201 Created`

```json
{
  "success": true,
  "data": {
    "id": "clx8f2k9p0001",
    "title": "Ticket #1234 — Beschwerde Streifendienst",
    "category": "Ticket-Transkript",
    "tags": ["ticket", "beschwerde"],
    "externalRef": "1234",
    "originalName": "ticket-1234.html",
    "mimeType": "text/html",
    "sizeBytes": 48213,
    "sha256": "9f2c…",
    "viewUrl": "/api/files/clx8f2k9p0001/raw",
    "createdAt": "2026-09-10T12:34:56.000Z",
    "duplicateOf": null
  }
}
```

`duplicateOf` ist gesetzt, wenn eine inhaltsgleiche Datei (gleicher SHA-256) bereits
existiert. Der Upload wird trotzdem angelegt — es ist ein Hinweis, keine Ablehnung.

## Erlaubte Dateitypen

`text/html`, `text/plain`, `text/markdown`, `text/csv`, `application/json`,
`application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`,
`video/mp4`, `video/webm`, `video/quicktime`.

Der Inhalt wird geprüft: Binärformate über ihre Magic Bytes, Textformate über die
UTF-8-Dekodierung. Eine als HTML deklarierte `.exe` wird abgewiesen. Schickt dein Client
keinen brauchbaren `Content-Type`, entscheidet die Dateiendung.

**Größenlimit:** 100 MB, änderbar über die Einstellung `fileUploadMaxBytes` (in Bytes).

## Fehler

| Status | Bedeutung |
|---|---|
| `400` | Feld fehlt oder ist ungültig (`file` fehlt, `metadata` kein gültiges JSON, leere Datei) |
| `401` | Kein oder unbekannter Upload-Schlüssel |
| `403` | Schlüssel widerrufen oder abgelaufen |
| `413` | Datei größer als das Limit |
| `415` | Dateityp nicht erlaubt |
| `422` | Der Inhalt passt nicht zum gemeldeten Typ |
| `500` | Serverfehler |

Fehlerantworten haben immer die Form `{ "success": false, "error": "…" }`.

## Dateien im Dashboard

Die folgenden Endpoints brauchen eine **Session** und die entsprechende Permission —
mit einem Upload-Schlüssel sind sie nicht erreichbar. Ein Schlüssel darf ausschließlich
hochladen, nichts lesen und nichts löschen.

| Endpoint | Recht | Zweck |
|---|---|---|
| `GET /api/files` | `uploads:view` | Liste mit `search`, `category`, `tag`, `from`, `to`, `page` |
| `GET /api/files/{id}` | `uploads:view` | Einzelner Upload |
| `GET /api/files/{id}/raw` | `uploads:view` | Dateiinhalt (mit Range-Unterstützung für Videos) |
| `PATCH /api/files/{id}` | `uploads:manage` | Metadaten ändern |
| `DELETE /api/files/{id}` | `uploads:manage` | Upload und Datei löschen |
| `GET/POST /api/upload-keys` | `uploads:manage` | Schlüssel auflisten und anlegen |
| `PATCH/DELETE /api/upload-keys/{id}` | `uploads:manage` | Schlüssel umbenennen, widerrufen, löschen |

## Warum HTML sicher angezeigt werden kann

Ein Ticket-Transkript ist fremdes HTML — würde das Dashboard es einfach einbetten,
könnte darin enthaltenes JavaScript die Session des Betrachters übernehmen.

Deshalb liefert `/api/files/{id}/raw` HTML zwar byte-genau aus, aber mit
`Content-Security-Policy: sandbox; default-src 'none'; …` und ohne `allow-scripts`
sowie ohne `allow-same-origin`. Das Dokument landet in einem eigenen, rechtelosen
Origin: kein Zugriff auf Cookies, kein Zugriff auf das Dashboard. Angezeigt wird es
zusätzlich in einem `<iframe sandbox>`.

Zwei bewusste Folgen:

- **JavaScript im Transkript läuft nicht.** Der Text bleibt vollständig lesbar,
  interaktive Elemente (Klappmenüs o. Ä.) sind tot.
- **Externe Bilder werden geladen.** Avatare aus einem Transkript kommen vom fremden
  Server, der dadurch die IP des Betrachters sieht. Soll das nicht sein, muss
  `img-src` in `src/lib/file-uploads.ts` auf `data:` beschränkt werden.

Bilder, PDFs und Videos bekommen die Sandbox-Regel bewusst **nicht** — sie würde den
eingebauten PDF-Viewer und die Videowiedergabe lahmlegen, ohne etwas zu schützen.
Gegen Typverwechslung schützt dort `X-Content-Type-Options: nosniff`.

## Wo der Code liegt

| Datei | Inhalt |
|---|---|
| `src/app/api/files/route.ts` | Upload und Liste |
| `src/app/api/files/[id]/route.ts` | Detail, Bearbeiten, Löschen |
| `src/app/api/files/[id]/raw/route.ts` | Auslieferung |
| `src/app/api/upload-keys/**` | Schlüsselverwaltung |
| `src/lib/upload-keys.ts` | Schlüssel erzeugen und prüfen |
| `src/lib/file-uploads.ts` | Ablage, Typprüfung, Auslieferungs-Header |
| `src/lib/file-upload-types.ts` | Erlaubte Typen (auch im Client genutzt) |
| `src/lib/file-upload-queries.ts` | Gemeinsame Abfragen und Fehlerbehandlung |
| `src/components/uploads/**` | Dashboard-Oberfläche |

Dateien liegen unter `<UPLOAD_DIR>/files/` und heißen `<uuid>.<endung>`; der
Originalname steht nur in der Datenbank.

# Chunked Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle vier Dateiwege des Dashboards laufen über einen gemeinsamen, wiederaufnehmbaren Chunk-Upload, bei dem kein einzelner Request größer als 8 MiB wird.

**Architecture:** Ein generischer Transportdienst unter `/api/uploads` nimmt Chunks entgegen, prüft jeden per SHA-256, legt ihn als eigene Datei unter `uploads/incoming/<sessionId>/<index>.part` ab und setzt sie beim Abschluss zu einer geprüften Datei zusammen. Die fachlichen Routen (Clip, Asservat, Foto, Akademie-Ressource) bekommen danach nur noch JSON-Metadaten plus ein einmal einlösbares Upload-Ticket und behalten ihre gesamte Logik. Der Fortschritt lebt im Dateisystem, nicht in der Datenbank — dadurch können Chunks parallel eintreffen, ohne dieselbe Zeile anzufassen.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Prisma 7 / MySQL, Node 22, `node:test` + `tsx` für Tests, React 19 im Client.

**Spec:** `docs/superpowers/specs/2026-09-09-chunked-uploads-design.md`

## Global Constraints

- Chunk-Größe: 8 MiB (`8 * 1024 * 1024`), über `UPLOAD_CHUNK_BYTES` konfigurierbar. Vom Server festgelegt, nie vom Client.
- Parallelität im Browser: 3 gleichzeitige Chunks, über `NEXT_PUBLIC_UPLOAD_CONCURRENCY` konfigurierbar.
- Sitzungslaufzeit: 24 h (`expiresAt`), Lease für das Zusammensetzen: 5 Minuten (identisch zu `staleAfterMs` in `src/lib/clip-compression.ts`).
- Kontingent: höchstens 3 gleichzeitig offene Sitzungen pro Nutzer.
- Größenlimits je Art: `CLIP` und `EVIDENCE` 500 MiB, `PHOTO` `MAX_PHOTO_UPLOAD_BYTES`, `RESOURCE` `uploadMaxBytes()`.
- Fremde oder unbekannte Sitzungen antworten immer mit **404**, nie mit 403.
- Alle Nutzertexte auf Deutsch, Code-Kommentare wie im umgebenden Code (Deutsch in `clips.ts`/Routen, Englisch in `clip-compression.ts`).
- Prisma-Konventionen: `String @id @default(cuid())`, explizite `@db.VarChar(n)`, Doc-Kommentare mit `///`.
- Tests laufen mit `npx tsx --test tests/<datei>.test.ts`.
- Jeder Commit endet mit den Attributionszeilen aus `AGENTS.md` bzw. der Sitzungsvorgabe.

## File Structure

**Neu:**
- `src/lib/upload-signatures.ts` — Magic-Byte-Prüfung, aus `corruption-evidence.ts` herausgezogen, für alle Arten nutzbar.
- `src/lib/upload-sessions.ts` — Kern des Transports: Regeln je Art, Sitzungsanlage, Chunk-Ablage, Zusammensetzen, Einlösen, Aufräumen. Kein HTTP, dadurch direkt testbar.
- `src/app/api/uploads/route.ts` — `POST` (Sitzung anlegen/finden).
- `src/app/api/uploads/[id]/route.ts` — `DELETE` (abbrechen).
- `src/app/api/uploads/[id]/chunks/[index]/route.ts` — `PUT` (ein Chunk).
- `src/app/api/uploads/[id]/complete/route.ts` — `POST` (zusammensetzen).
- `src/lib/chunked-upload.ts` — Client-Bibliothek, framework-frei.
- `tests/upload-sessions.test.ts` — Kern des Transports.
- `tests/chunked-uploads.test.ts` — Ende-zu-Ende über echtes HTTP.

**Geändert:**
- `prisma/schema.prisma` — Modell `UploadSession`.
- `src/lib/corruption-evidence.ts` — `matchesEvidenceType` wandert nach `upload-signatures.ts`.
- `src/proxy.ts:55` — Matcher-Ausnahme wandert auf die Chunk-Route.
- `src/lib/upload-cors.ts` — Header-Liste.
- `src/app/api/investigations/clips/route.ts`, `src/app/api/corruption-checks/[id]/evidence/route.ts`, `src/app/api/investigations/photos/upload/route.ts`, `src/app/api/academy/resources/route.ts` — nehmen Tickets statt Rohbodys.
- `src/components/investigations/clip-upload-dialog.tsx`, `src/components/corruption/report-tools.tsx`, `src/components/modules/academy-resources.tsx` — nutzen `uploadInChunks`.
- `src/lib/clip-compression.ts` — Aufräum-Auftrag im bestehenden Intervall-Worker.

---

### Task 1: Datenmodell `UploadSession`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nichts.
- Produces: Prisma-Modell `UploadSession` mit den Feldern `id, kind, ownerId, fingerprint, originalName, mimeType, totalBytes, chunkSize, chunkCount, status, assembleStartedAt, storedFilename, sha256, error, expiresAt, createdAt, updatedAt`. Relation `User.uploadSessions`.

- [ ] **Step 1: Modell ergänzen**

Ans Ende von `prisma/schema.prisma` anfügen:

```prisma
/// Eine laufende, wiederaufnehmbare Dateiübertragung. Der Fortschritt steht
/// bewusst nicht hier, sondern im Dateisystem unter `uploads/incoming/<id>/`:
/// so schreiben parallel eintreffende Chunks verschiedene Dateien statt
/// dieselbe Zeile, und es gibt keine verlorenen Updates.
model UploadSession {
  id String @id @default(cuid())

  /// CLIP | EVIDENCE | PHOTO | RESOURCE
  kind    String @db.VarChar(20)
  ownerId String
  owner   User   @relation("UploadSessionOwner", fields: [ownerId], references: [id], onDelete: Cascade)

  /// Aus Dateiname, Größe und Änderungsdatum. Findet eine angefangene
  /// Sitzung wieder, wenn der Nutzer dieselbe Datei erneut auswählt.
  fingerprint  String @db.VarChar(120)
  originalName String @db.VarChar(255)
  /// Deklaration des Clients; beim Abschluss gegen die echten Bytes geprüft.
  mimeType     String @db.VarChar(120)
  totalBytes   BigInt
  chunkSize    Int
  chunkCount   Int

  /// OPEN | ASSEMBLING | DONE | CONSUMED | FAILED
  status            String    @default("OPEN") @db.VarChar(20)
  /// Heartbeat des Zusammensetzens, analog zu BodycamClip.compressionStartedAt.
  assembleStartedAt DateTime?
  storedFilename    String?   @db.VarChar(80)
  sha256            String?   @db.VarChar(64)
  error             String?   @db.VarChar(300)

  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([ownerId, fingerprint, status])
  @@index([status, expiresAt])
}
```

- [ ] **Step 2: Gegenseite am `User` ergänzen**

Im Modell `User` bei den übrigen Relationen anfügen:

```prisma
  uploadSessions UploadSession[] @relation("UploadSessionOwner")
```

- [ ] **Step 3: Client erzeugen und Schema prüfen**

Run: `npx prisma validate` danach `npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` und ein erfolgreich erzeugter Client.

- [ ] **Step 4: Schema auf die Entwicklungsdatenbank bringen**

Run: `npm run db:push`
Expected: Tabelle `UploadSession` wird angelegt. Das Skript legt vorher ein Backup an.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: Datenmodell für wiederaufnehmbare Upload-Sitzungen"
```

---

### Task 2: Geteilte Magic-Byte-Prüfung

`matchesEvidenceType` in `src/lib/corruption-evidence.ts:16` kann das bereits — aber nur für Asservate und ohne MKV, das Clips erlauben. Wir ziehen es heraus und ergänzen es.

**Files:**
- Create: `src/lib/upload-signatures.ts`
- Modify: `src/lib/corruption-evidence.ts:16`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `matchesFileSignature(mime: string, head: Buffer): boolean` — akzeptiert zusätzlich `video/x-matroska`. `matchesEvidenceType` bleibt als Re-Export bestehen, damit vorhandene Aufrufer unverändert weiterlaufen.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/upload-sessions.test.ts` neu anlegen:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesFileSignature } from '../src/lib/upload-signatures'

function head(bytes: number[]) {
  const buffer = Buffer.alloc(32)
  Buffer.from(bytes).copy(buffer)
  return buffer
}

test('Signaturprüfung erkennt erlaubte Formate und weist fremde ab', () => {
  const mp4 = Buffer.alloc(32)
  mp4.write('ftyp', 4, 'ascii')
  assert.equal(matchesFileSignature('video/mp4', mp4), true)
  assert.equal(matchesFileSignature('video/quicktime', mp4), true)

  // WebM und MKV teilen sich die EBML-Signatur und sind hier nicht
  // unterscheidbar - beide müssen akzeptiert werden.
  const ebml = head([0x1a, 0x45, 0xdf, 0xa3])
  assert.equal(matchesFileSignature('video/webm', ebml), true)
  assert.equal(matchesFileSignature('video/x-matroska', ebml), true)

  assert.equal(matchesFileSignature('image/png', head([137, 80, 78, 71, 13, 10, 26, 10])), true)
  assert.equal(matchesFileSignature('application/pdf', head([0x25, 0x50, 0x44, 0x46, 0x2d])), true)

  // Eine ausführbare Datei, die sich als Video ausgibt.
  assert.equal(matchesFileSignature('video/mp4', head([0x4d, 0x5a, 0x90, 0x00])), false)
  assert.equal(matchesFileSignature('application/x-msdownload', head([0x4d, 0x5a])), false)
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/upload-signatures'`.

- [ ] **Step 3: Modul anlegen**

`src/lib/upload-signatures.ts`:

```ts
/**
 * Prüft die ersten Bytes einer Datei gegen den deklarierten MIME-Typ, statt
 * dem `Content-Type` des Clients zu glauben.
 *
 * Bewusste Einschränkung: WebM und MKV teilen sich die EBML-Signatur
 * `1A 45 DF A3` und lassen sich hier nicht auseinanderhalten. Geprüft wird
 * deshalb gegen die erlaubte Signaturgruppe, nicht auf exakte Übereinstimmung
 * zweier erlaubter Containerformate.
 */
export function matchesFileSignature(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())
  if (mime === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  if (mime === 'application/pdf') return b.subarray(0, 5).toString() === '%PDF-'
  if (mime === 'video/webm' || mime === 'video/x-matroska') return b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  if (mime === 'video/mp4' || mime === 'video/quicktime') return b.subarray(4, 8).toString() === 'ftyp'
  return false
}
```

- [ ] **Step 4: Alte Stelle auf das neue Modul umstellen**

In `src/lib/corruption-evidence.ts` den Rumpf von `matchesEvidenceType` (Zeilen 16–24) ersetzen durch:

```ts
export { matchesFileSignature as matchesEvidenceType } from './upload-signatures'
```

Den Import `import { matchesFileSignature } from './upload-signatures'` ergänzen und den Aufruf in `saveEvidence` auf `matchesFileSignature` umstellen.

- [ ] **Step 5: Tests laufen lassen**

Run: `npx tsx --test tests/upload-sessions.test.ts tests/large-uploads.test.ts`
Expected: PASS in beiden Dateien — der bestehende Asservate-Test darf durch die Verschiebung nicht brechen.

- [ ] **Step 6: Commit**

```bash
git add src/lib/upload-signatures.ts src/lib/corruption-evidence.ts tests/upload-sessions.test.ts
git commit -m "refactor: Magic-Byte-Prüfung in ein geteiltes Modul gezogen"
```

---

### Task 3: Regeln je Upload-Art und Chunk-Ablage

**Files:**
- Create: `src/lib/upload-sessions.ts`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: `matchesFileSignature` (Task 2), `uploadDir()` aus `src/lib/uploads.ts`, `clipMaxBytes()` aus `src/lib/clips.ts`, `MAX_PHOTO_UPLOAD_BYTES` aus `src/lib/investigation-photo-upload.ts`, `uploadMaxBytes()` aus `src/lib/uploads.ts`.
- Produces:
  - `type UploadKind = 'CLIP' | 'EVIDENCE' | 'PHOTO' | 'RESOURCE'`
  - `uploadKindRules: Record<UploadKind, { maxBytes: () => number; types: Record<string, string> }>` — `types` bildet MIME auf Endung ab.
  - `class UploadSessionError extends Error { status: number }`
  - `uploadChunkBytes(): number`
  - `incomingDir(sessionId: string): string`
  - `chunkPath(sessionId: string, index: number): string`
  - `receivedChunkIndexes(sessionId: string): Promise<number[]>`
  - `chunkCountFor(totalBytes: number, chunkSize: number): number`

- [ ] **Step 1: Fehlschlagende Tests anhängen**

An `tests/upload-sessions.test.ts` anhängen:

```ts
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  chunkCountFor,
  chunkPath,
  incomingDir,
  receivedChunkIndexes,
  uploadChunkBytes,
  uploadKindRules,
  UploadSessionError,
} from '../src/lib/upload-sessions'

test('Chunk-Aufteilung und Pfade', async () => {
  assert.equal(uploadChunkBytes(), 8 * 1024 * 1024)
  assert.equal(chunkCountFor(8 * 1024 * 1024, 8 * 1024 * 1024), 1)
  assert.equal(chunkCountFor(8 * 1024 * 1024 + 1, 8 * 1024 * 1024), 2)
  assert.equal(chunkCountFor(214958080, 8 * 1024 * 1024), 26)

  assert.equal(uploadKindRules.CLIP.types['video/x-matroska'], '.mkv')
  assert.equal(uploadKindRules.RESOURCE.maxBytes(), 10 * 1024 * 1024)

  // Ein manipulierter Bezeichner darf nie aus dem Zielordner herausführen.
  assert.throws(() => incomingDir('../../etc'), UploadSessionError)
  assert.throws(() => chunkPath('clx123', -1), UploadSessionError)
  assert.throws(() => chunkPath('clx123', 1.5), UploadSessionError)
})

test('Empfangene Chunks werden aus dem Dateisystem gelesen', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const session = 'clxsession0001'
  await mkdir(incomingDir(session), { recursive: true })
  await writeFile(chunkPath(session, 3), 'x')
  await writeFile(chunkPath(session, 0), 'x')
  // Eine halbfertige Datei zählt nicht mit.
  await writeFile(path.join(incomingDir(session), '7.tmp'), 'x')

  assert.deepEqual(await receivedChunkIndexes(session), [0, 3])
  assert.deepEqual(await receivedChunkIndexes('clxsession0002'), [])
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/upload-sessions'`.

- [ ] **Step 3: Modul anlegen**

`src/lib/upload-sessions.ts`:

```ts
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { clipMaxBytes, ALLOWED_CLIP_TYPES } from './clips'
import { evidenceTypes } from './corruption-evidence'
import { MAX_PHOTO_UPLOAD_BYTES } from './investigation-photo-upload'
import { uploadDir, uploadMaxBytes } from './uploads'

export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type UploadKind = 'CLIP' | 'EVIDENCE' | 'PHOTO' | 'RESOURCE'

export class UploadSessionError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UploadSessionError'
    this.status = status
  }
}

/** MIME-Typ auf Dateiendung, jeweils mit führendem Punkt. */
function withDots(types: Record<string, string>) {
  return Object.fromEntries(Object.entries(types).map(([mime, ext]) => [mime, ext.startsWith('.') ? ext : `.${ext}`]))
}

export const uploadKindRules: Record<UploadKind, { maxBytes: () => number; types: Record<string, string> }> = {
  CLIP: { maxBytes: clipMaxBytes, types: ALLOWED_CLIP_TYPES },
  EVIDENCE: { maxBytes: () => 500 * 1024 * 1024, types: withDots(evidenceTypes) },
  PHOTO: {
    maxBytes: () => MAX_PHOTO_UPLOAD_BYTES,
    types: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' },
  },
  RESOURCE: {
    maxBytes: uploadMaxBytes,
    types: {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    },
  },
}

export function uploadChunkBytes() {
  const raw = Number.parseInt(process.env.UPLOAD_CHUNK_BYTES || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_CHUNK_BYTES
}

export function chunkCountFor(totalBytes: number, chunkSize: number) {
  return Math.max(1, Math.ceil(totalBytes / chunkSize))
}

/** cuid, wie Prisma sie erzeugt - bewusst eng, weil daraus ein Pfad wird. */
function assertSessionId(sessionId: string) {
  if (!/^[a-z0-9]{20,32}$/i.test(sessionId)) throw new UploadSessionError('Sitzung nicht gefunden', 404)
}

export function incomingDir(sessionId: string) {
  assertSessionId(sessionId)
  const base = path.join(/*turbopackIgnore: true*/ uploadDir(), 'incoming')
  const target = path.normalize(path.join(/*turbopackIgnore: true*/ base, sessionId))
  if (!target.startsWith(`${base}${path.sep}`)) throw new UploadSessionError('Sitzung nicht gefunden', 404)
  return target
}

export function chunkPath(sessionId: string, index: number, extension = '.part') {
  if (!Number.isSafeInteger(index) || index < 0) throw new UploadSessionError('Ungültiger Chunk-Index')
  return path.join(/*turbopackIgnore: true*/ incomingDir(sessionId), `${index}${extension}`)
}

/**
 * Der Fortschritt kommt aus dem Dateisystem: ein `.part` entsteht erst durch
 * das abschließende Umbenennen, existiert also nur für vollständig geprüfte
 * Chunks. Halbfertige `.tmp` zählen nicht mit.
 */
export async function receivedChunkIndexes(sessionId: string): Promise<number[]> {
  let entries: string[]
  try {
    entries = await readdir(incomingDir(sessionId))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }

  return entries
    .filter((name) => name.endsWith('.part'))
    .map((name) => Number.parseInt(name.slice(0, -'.part'.length), 10))
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((a, b) => a - b)
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: PASS, beide Tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-sessions.ts tests/upload-sessions.test.ts
git commit -m "feat: Regeln je Upload-Art und Chunk-Ablage im Dateisystem"
```

---

### Task 4: Chunk schreiben und prüfen

**Files:**
- Modify: `src/lib/upload-sessions.ts`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `storeChunk(sessionId: string, index: number, body: ReadableStream<Uint8Array>, expectedSha256: string, expectedBytes: number): Promise<void>` — wirft `UploadSessionError` bei falscher Länge oder Prüfsumme und hinterlässt in dem Fall keine `.part`-Datei.

- [ ] **Step 1: Fehlschlagenden Test anhängen**

```ts
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { readdir } from 'node:fs/promises'
import { storeChunk } from '../src/lib/upload-sessions'

function streamOf(buffer: Buffer) {
  return Readable.toWeb(Readable.from([buffer])) as ReadableStream<Uint8Array>
}

test('Chunks werden nur bei passender Länge und Prüfsumme abgelegt', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const session = 'clxsession0003'
  const payload = Buffer.alloc(1024, 0x41)
  const digest = createHash('sha256').update(payload).digest('hex')

  await storeChunk(session, 0, streamOf(payload), digest, payload.length)
  assert.deepEqual(await receivedChunkIndexes(session), [0])

  // Doppelte Zustellung nach einem Wiederholversuch ist unschädlich.
  await storeChunk(session, 0, streamOf(payload), digest, payload.length)
  assert.deepEqual(await receivedChunkIndexes(session), [0])

  await assert.rejects(
    () => storeChunk(session, 1, streamOf(payload), 'f'.repeat(64), payload.length),
    (cause: UploadSessionError) => cause.status === 400,
  )
  await assert.rejects(
    () => storeChunk(session, 2, streamOf(payload), digest, payload.length + 1),
    (cause: UploadSessionError) => cause.status === 400,
  )

  // Abgelehnte Chunks hinterlassen weder .part noch .tmp.
  assert.deepEqual(await receivedChunkIndexes(session), [0])
  assert.deepEqual((await readdir(incomingDir(session))).sort(), ['0.part'])
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `storeChunk is not a function`.

- [ ] **Step 3: `storeChunk` ergänzen**

In `src/lib/upload-sessions.ts` die Importe erweitern und die Funktion anfügen:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
```

```ts
/**
 * Schreibt einen Chunk nach `<index>.tmp` und benennt ihn erst nach
 * bestandener Prüfung auf `<index>.part` um. Dadurch existiert ein `.part`
 * ausschließlich für vollständige, verifizierte Daten - und der Fortschritt
 * lässt sich allein aus dem Ordner ablesen.
 */
export async function storeChunk(
  sessionId: string,
  index: number,
  body: ReadableStream<Uint8Array>,
  expectedSha256: string,
  expectedBytes: number,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new UploadSessionError('Ungültige Prüfsumme')

  const target = chunkPath(sessionId, index)
  const temporary = chunkPath(sessionId, index, `.${randomUUID()}.tmp`)
  await mkdir(incomingDir(sessionId), { recursive: true })

  let sizeBytes = 0
  const hash = createHash('sha256')
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length
      if (sizeBytes > expectedBytes) {
        callback(new UploadSessionError('Chunk ist größer als angekündigt'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
    await pipeline(source, meter, createWriteStream(temporary))

    if (sizeBytes !== expectedBytes) throw new UploadSessionError('Chunk ist unvollständig')

    const actual = Buffer.from(hash.digest('hex'), 'utf8')
    const expected = Buffer.from(expectedSha256.toLowerCase(), 'utf8')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UploadSessionError('Prüfsumme des Chunks stimmt nicht')
    }

    await rename(temporary, target)
  } catch (cause) {
    await unlink(temporary).catch(() => {})
    throw cause
  }
}
```

`randomUUID` aus `node:crypto` mit importieren. Der zufällige Zwischenname verhindert, dass zwei gleichzeitige Zustellungen desselben Index einander die `.tmp` unter den Füßen wegziehen.

- [ ] **Step 4: Tests laufen lassen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: PASS, alle Tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-sessions.ts tests/upload-sessions.test.ts
git commit -m "feat: Chunks per Prüfsumme verifiziert ablegen"
```

---

### Task 5: Sitzung anlegen, wiederfinden, abbrechen

**Files:**
- Modify: `src/lib/upload-sessions.ts`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: Task 3 und 4, `prisma` aus `src/lib/prisma.ts`.
- Produces:
  - `openUploadSession(input: { kind: UploadKind; ownerId: string; originalName: string; mimeType: string; totalBytes: number; fingerprint: string }): Promise<{ sessionId: string; chunkSize: number; chunkCount: number; received: number[]; resumed: boolean }>`
  - `loadOwnedSession(sessionId: string, ownerId: string): Promise<UploadSession>` — wirft 404 statt 403 bei fremdem Besitzer.
  - `cancelUploadSession(sessionId: string, ownerId: string): Promise<void>`
  - `MAX_OPEN_SESSIONS_PER_USER = 3`

- [ ] **Step 1: Fehlschlagenden Test anhängen**

Der Test läuft gegen die echte Entwicklungsdatenbank und legt sich einen eigenen Nutzer an, den er am Ende wieder entfernt.

```ts
import { prisma } from '../src/lib/prisma'
import { openUploadSession, loadOwnedSession, cancelUploadSession, MAX_OPEN_SESSIONS_PER_USER } from '../src/lib/upload-sessions'

test('Sitzungen werden wiedergefunden, begrenzt und geschützt', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const owner = await prisma.user.create({
    data: { username: `t-${randomUUID()}`, displayName: 'Testnutzer', passwordHash: 'x', role: 'ADMIN' },
  })
  const stranger = await prisma.user.create({
    data: { username: `t-${randomUUID()}`, displayName: 'Fremder', passwordHash: 'x', role: 'ADMIN' },
  })
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: { in: [owner.id, stranger.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })
  })

  const input = {
    kind: 'CLIP' as const,
    ownerId: owner.id,
    originalName: 'zugriff.mp4',
    mimeType: 'video/mp4',
    totalBytes: 214958080,
    fingerprint: 'zugriff.mp4:214958080:1757320145000',
  }

  const first = await openUploadSession(input)
  assert.equal(first.chunkCount, 26)
  assert.equal(first.resumed, false)
  assert.deepEqual(first.received, [])

  const payload = Buffer.alloc(64, 7)
  await storeChunk(first.sessionId, 0, streamOf(payload), createHash('sha256').update(payload).digest('hex'), payload.length)

  // Dieselbe Datei erneut gewählt: dieselbe Sitzung, mit Fortschritt.
  const again = await openUploadSession(input)
  assert.equal(again.sessionId, first.sessionId)
  assert.equal(again.resumed, true)
  assert.deepEqual(again.received, [0])

  // Ein zu großer Clip wird abgelehnt, bevor ein einziges Byte fließt.
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'zu-gross', totalBytes: 900 * 1024 * 1024 }),
    (cause: UploadSessionError) => cause.status === 413,
  )

  // Ein nicht erlaubtes Format ebenso.
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'falsch', mimeType: 'application/x-msdownload' }),
    (cause: UploadSessionError) => cause.status === 415,
  )

  // Kontingent: die vierte offene Sitzung wird abgewiesen.
  for (let n = 2; n <= MAX_OPEN_SESSIONS_PER_USER; n += 1) {
    await openUploadSession({ ...input, fingerprint: `datei-${n}` })
  }
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'eine-zu-viel' }),
    (cause: UploadSessionError) => cause.status === 429,
  )

  // Fremde Sitzungen existieren nach außen nicht.
  await assert.rejects(
    () => loadOwnedSession(first.sessionId, stranger.id),
    (cause: UploadSessionError) => cause.status === 404,
  )
  await assert.rejects(
    () => cancelUploadSession(first.sessionId, stranger.id),
    (cause: UploadSessionError) => cause.status === 404,
  )

  await cancelUploadSession(first.sessionId, owner.id)
  assert.deepEqual(await receivedChunkIndexes(first.sessionId), [])
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `openUploadSession is not a function`.

- [ ] **Step 3: Implementieren**

In `src/lib/upload-sessions.ts` ergänzen (`rm` aus `node:fs/promises` mit importieren):

```ts
import { prisma } from './prisma'
import type { UploadSession } from '@/generated/prisma'

export const MAX_OPEN_SESSIONS_PER_USER = 3
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export interface OpenUploadSessionInput {
  kind: UploadKind
  ownerId: string
  originalName: string
  mimeType: string
  totalBytes: number
  fingerprint: string
}

export async function openUploadSession(input: OpenUploadSessionInput) {
  const rules = uploadKindRules[input.kind]
  if (!rules) throw new UploadSessionError('Unbekannte Upload-Art')
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new UploadSessionError('Ungültige Dateigröße')
  }
  if (input.totalBytes > rules.maxBytes()) {
    throw new UploadSessionError(`Datei ist zu groß (max. ${Math.floor(rules.maxBytes() / (1024 * 1024))} MB)`, 413)
  }
  if (!rules.types[input.mimeType]) {
    throw new UploadSessionError('Nicht unterstütztes Dateiformat', 415)
  }

  const existing = await prisma.uploadSession.findFirst({
    where: { ownerId: input.ownerId, kind: input.kind, fingerprint: input.fingerprint, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  })

  // Gleiche Datei, gleiche Größe: da machen wir weiter. Weicht die Größe ab,
  // hat sich die Datei geändert - die alte Sitzung ist dann wertlos.
  if (existing && Number(existing.totalBytes) === input.totalBytes && existing.expiresAt > new Date()) {
    return {
      sessionId: existing.id,
      chunkSize: existing.chunkSize,
      chunkCount: existing.chunkCount,
      received: await receivedChunkIndexes(existing.id),
      resumed: true,
    }
  }
  if (existing) await cancelUploadSession(existing.id, input.ownerId)

  const open = await prisma.uploadSession.count({ where: { ownerId: input.ownerId, status: 'OPEN' } })
  if (open >= MAX_OPEN_SESSIONS_PER_USER) {
    throw new UploadSessionError(
      `Es laufen bereits ${MAX_OPEN_SESSIONS_PER_USER} Uploads. Bitte einen davon abschließen oder abbrechen.`,
      429,
    )
  }

  const chunkSize = uploadChunkBytes()
  const session = await prisma.uploadSession.create({
    data: {
      kind: input.kind,
      ownerId: input.ownerId,
      fingerprint: input.fingerprint.slice(0, 120),
      originalName: input.originalName.slice(0, 255),
      mimeType: input.mimeType,
      totalBytes: BigInt(input.totalBytes),
      chunkSize,
      chunkCount: chunkCountFor(input.totalBytes, chunkSize),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })

  return {
    sessionId: session.id,
    chunkSize: session.chunkSize,
    chunkCount: session.chunkCount,
    received: [] as number[],
    resumed: false,
  }
}

/**
 * Eine fremde Sitzung antwortet wie eine nicht vorhandene: dass es sie gibt,
 * ist keine Information, die wir preisgeben müssen.
 */
export async function loadOwnedSession(sessionId: string, ownerId: string): Promise<UploadSession> {
  assertSessionId(sessionId)
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } })
  if (!session || session.ownerId !== ownerId) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  return session
}

export async function cancelUploadSession(sessionId: string, ownerId: string) {
  const session = await loadOwnedSession(sessionId, ownerId)
  await rm(incomingDir(session.id), { recursive: true, force: true })
  await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {})
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: PASS. Falls die Datenbank nicht erreichbar ist, zuerst `DATABASE_URL` setzen — der Test braucht eine echte Verbindung, weil er die Kontingent-Zählung prüft.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-sessions.ts tests/upload-sessions.test.ts
git commit -m "feat: Upload-Sitzungen anlegen, wiederfinden und begrenzen"
```

---

### Task 6: Zusammensetzen und Einlösen

**Files:**
- Modify: `src/lib/upload-sessions.ts`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: Task 5, `matchesFileSignature` (Task 2).
- Produces:
  - `assembleUploadSession(sessionId: string, ownerId: string): Promise<{ sessionId: string; sizeBytes: number; mimeType: string; sha256: string }>`
  - `consumeUploadSession(sessionId: string, ownerId: string, kind: UploadKind, moveTo: (source: string, extension: string) => Promise<string>): Promise<{ filename: string; sizeBytes: number; mimeType: string; originalName: string; sha256: string }>`
  - `stagedPath(sessionId: string, extension: string): string`

- [ ] **Step 1: Fehlschlagenden Test anhängen**

```ts
import { readFile } from 'node:fs/promises'
import { assembleUploadSession, consumeUploadSession, stagedPath } from '../src/lib/upload-sessions'

test('Zusammensetzen prüft Vollständigkeit, Format und liefert ein einmaliges Ticket', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  process.env.UPLOAD_CHUNK_BYTES = String(1024)
  t.after(() => { delete process.env.UPLOAD_CHUNK_BYTES })

  const owner = await prisma.user.create({
    data: { username: `t-${randomUUID()}`, displayName: 'Testnutzer', passwordHash: 'x', role: 'ADMIN' },
  })
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  const file = Buffer.alloc(2500, 0x5a)
  file.write('ftyp', 4, 'ascii')
  const expectedHash = createHash('sha256').update(file).digest('hex')

  const session = await openUploadSession({
    kind: 'CLIP', ownerId: owner.id, originalName: 'a.mp4', mimeType: 'video/mp4',
    totalBytes: file.length, fingerprint: 'a.mp4:2500:1',
  })
  assert.equal(session.chunkCount, 3)

  // Unvollständig: das Zusammensetzen muss scheitern.
  await assert.rejects(() => assembleUploadSession(session.sessionId, owner.id), UploadSessionError)

  // Absichtlich in vertauschter Reihenfolge senden.
  for (const index of [2, 0, 1]) {
    const part = file.subarray(index * 1024, Math.min((index + 1) * 1024, file.length))
    await storeChunk(session.sessionId, index, streamOf(part), createHash('sha256').update(part).digest('hex'), part.length)
  }

  const result = await assembleUploadSession(session.sessionId, owner.id)
  assert.equal(result.sizeBytes, file.length)
  assert.equal(result.sha256, expectedHash)
  assert.deepEqual(await readFile(stagedPath(session.sessionId, '.mp4')), file)
  // Der Chunk-Ordner ist danach weg.
  assert.deepEqual(await receivedChunkIndexes(session.sessionId), [])

  // Einlösen verschiebt die Datei und entwertet das Ticket.
  const targets: string[] = []
  const ticket = await consumeUploadSession(session.sessionId, owner.id, 'CLIP', async (source, extension) => {
    const target = path.join(directory, `final${extension}`)
    await rename(source, target)
    targets.push(target)
    return path.basename(target)
  })
  assert.equal(ticket.filename, 'final.mp4')
  assert.equal(ticket.originalName, 'a.mp4')
  await assert.rejects(
    () => consumeUploadSession(session.sessionId, owner.id, 'CLIP', async () => 'x'),
    (cause: UploadSessionError) => cause.status === 409,
  )
})

test('Eine Datei mit fremder Signatur wird beim Abschluss abgewiesen', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const owner = await prisma.user.create({
    data: { username: `t-${randomUUID()}`, displayName: 'Testnutzer', passwordHash: 'x', role: 'ADMIN' },
  })
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  // Eine Windows-Programmdatei, die sich als MP4 ausgibt.
  const disguised = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
  const session = await openUploadSession({
    kind: 'CLIP', ownerId: owner.id, originalName: 'b.mp4', mimeType: 'video/mp4',
    totalBytes: disguised.length, fingerprint: 'b.mp4:8:1',
  })
  await storeChunk(session.sessionId, 0, streamOf(disguised), createHash('sha256').update(disguised).digest('hex'), disguised.length)

  await assert.rejects(
    () => assembleUploadSession(session.sessionId, owner.id),
    (cause: UploadSessionError) => cause.status === 415,
  )
  const stored = await prisma.uploadSession.findUnique({ where: { id: session.sessionId } })
  assert.equal(stored?.status, 'FAILED')
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `assembleUploadSession is not a function`.

- [ ] **Step 3: Implementieren**

In `src/lib/upload-sessions.ts` ergänzen (`createReadStream` aus `node:fs`, `stat` aus `node:fs/promises` importieren):

```ts
const ASSEMBLE_LEASE_MS = 5 * 60_000

export function stagedPath(sessionId: string, extension: string) {
  assertSessionId(sessionId)
  if (!/^\.[a-z0-9]{1,8}$/i.test(extension)) throw new UploadSessionError('Ungültige Dateiendung')
  const base = path.join(/*turbopackIgnore: true*/ uploadDir(), 'staging')
  return path.join(/*turbopackIgnore: true*/ base, `${sessionId}${extension}`)
}

/**
 * Setzt die Chunks in aufsteigender Reihenfolge zusammen und prüft dabei in
 * einem Durchlauf Vollständigkeit, Gesamtgröße und Dateisignatur.
 *
 * Der Übergang OPEN -> ASSEMBLING läuft als Compare-and-Swap, damit zwei
 * gleichzeitige Aufrufe oder zwei Serverinstanzen nicht beide zusammensetzen -
 * dasselbe Muster wie compressNextClip() in clip-compression.ts.
 */
export async function assembleUploadSession(sessionId: string, ownerId: string) {
  const session = await loadOwnedSession(sessionId, ownerId)
  if (session.status === 'DONE') {
    return {
      sessionId: session.id,
      sizeBytes: Number(session.totalBytes),
      mimeType: session.mimeType,
      sha256: session.sha256!,
    }
  }

  const staleBefore = new Date(Date.now() - ASSEMBLE_LEASE_MS)
  const claimed = await prisma.uploadSession.updateMany({
    where: {
      id: session.id,
      OR: [{ status: 'OPEN' }, { status: 'ASSEMBLING', assembleStartedAt: { lt: staleBefore } }],
    },
    data: { status: 'ASSEMBLING', assembleStartedAt: new Date(), error: null },
  })
  if (!claimed.count) throw new UploadSessionError('Der Upload wird bereits abgeschlossen', 409)

  const extension = uploadKindRules[session.kind as UploadKind].types[session.mimeType]
  const target = stagedPath(session.id, extension)

  const fail = async (message: string, status: number) => {
    await prisma.uploadSession.updateMany({
      where: { id: session.id, status: 'ASSEMBLING' },
      data: { status: 'FAILED', error: message.slice(0, 300), assembleStartedAt: null },
    })
    await unlink(target).catch(() => {})
    throw new UploadSessionError(message, status)
  }

  const received = await receivedChunkIndexes(session.id)
  if (received.length !== session.chunkCount) {
    return fail(`Es fehlen ${session.chunkCount - received.length} von ${session.chunkCount} Teilen`, 409)
  }

  await mkdir(path.dirname(target), { recursive: true })
  const hash = createHash('sha256')
  let sizeBytes = 0
  let head = Buffer.alloc(0)
  const output = createWriteStream(target)

  try {
    for (let index = 0; index < session.chunkCount; index += 1) {
      const source = createReadStream(chunkPath(session.id, index))
      for await (const piece of source) {
        const buffer = piece as Buffer
        sizeBytes += buffer.length
        hash.update(buffer)
        if (head.length < 32) head = Buffer.concat([head, buffer.subarray(0, 32 - head.length)])
        if (!output.write(buffer)) await new Promise((resolve) => output.once('drain', resolve))
      }
    }
    await new Promise<void>((resolve, reject) => output.end((cause?: Error) => (cause ? reject(cause) : resolve())))
  } catch (cause) {
    output.destroy()
    return fail(cause instanceof Error ? cause.message : 'Zusammensetzen fehlgeschlagen', 500)
  }

  if (sizeBytes !== Number(session.totalBytes)) {
    return fail('Die zusammengesetzte Datei hat nicht die angekündigte Größe', 409)
  }
  if (!matchesFileSignature(session.mimeType, head)) {
    return fail('Der Dateiinhalt passt nicht zum angegebenen Format', 415)
  }

  const sha256 = hash.digest('hex')
  await prisma.uploadSession.updateMany({
    where: { id: session.id, status: 'ASSEMBLING' },
    data: { status: 'DONE', storedFilename: path.basename(target), sha256, assembleStartedAt: null },
  })
  await rm(incomingDir(session.id), { recursive: true, force: true })

  return { sessionId: session.id, sizeBytes, mimeType: session.mimeType, sha256 }
}

/**
 * Löst ein Ticket ein: `moveTo` bekommt die fertige Datei und liefert den
 * endgültigen Dateinamen zurück. Der Statusübergang DONE -> CONSUMED ist ein
 * Compare-and-Swap, deshalb lässt sich ein Ticket nicht zweimal einlösen.
 */
export async function consumeUploadSession(
  sessionId: string,
  ownerId: string,
  kind: UploadKind,
  moveTo: (source: string, extension: string) => Promise<string>,
) {
  const session = await loadOwnedSession(sessionId, ownerId)
  if (session.kind !== kind) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  if (session.status !== 'DONE' || !session.storedFilename) {
    throw new UploadSessionError('Der Upload ist nicht abgeschlossen', 409)
  }

  const claimed = await prisma.uploadSession.updateMany({
    where: { id: session.id, status: 'DONE' },
    data: { status: 'CONSUMED' },
  })
  if (!claimed.count) throw new UploadSessionError('Der Upload wurde bereits übernommen', 409)

  const extension = path.extname(session.storedFilename)
  try {
    const filename = await moveTo(stagedPath(session.id, extension), extension)
    return {
      filename,
      sizeBytes: Number(session.totalBytes),
      mimeType: session.mimeType,
      originalName: session.originalName,
      sha256: session.sha256!,
    }
  } catch (cause) {
    // Zurück auf DONE, damit der Nutzer es erneut versuchen kann, ohne die
    // gesamte Datei noch einmal zu übertragen.
    await prisma.uploadSession.updateMany({ where: { id: session.id, status: 'CONSUMED' }, data: { status: 'DONE' } })
    throw cause
  }
}
```

`matchesFileSignature` und `rename` mit importieren.

- [ ] **Step 4: Tests laufen lassen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: PASS, alle Tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-sessions.ts tests/upload-sessions.test.ts
git commit -m "feat: Chunks zusammensetzen, prüfen und als einmaliges Ticket einlösen"
```

---

### Task 7: API-Routen für den Transport

**Files:**
- Create: `src/app/api/uploads/route.ts`, `src/app/api/uploads/[id]/route.ts`, `src/app/api/uploads/[id]/chunks/[index]/route.ts`, `src/app/api/uploads/[id]/complete/route.ts`
- Modify: `src/proxy.ts:55`, `src/lib/upload-cors.ts`
- Test: `tests/chunked-uploads.test.ts`

**Interfaces:**
- Consumes: Task 3–6.
- Produces: die vier Endpunkte aus der Spec sowie `authorizeUploadKind(kind: UploadKind)` in `src/lib/upload-sessions.ts`, das die je Art zuständige Berechtigung prüft und den Nutzer liefert.

- [ ] **Step 1: Fehlschlagenden Test für den Proxy-Matcher schreiben**

`tests/chunked-uploads.test.ts` neu anlegen:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { config } from '../src/proxy'

const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (pattern: string) => RegExp
}

test('Nur die Chunk-Route umgeht den Body-klonenden Proxy', () => {
  const matcher = pathToRegexp(config.matcher)
  assert.equal(matcher.test('/api/uploads/clx0000000000000000001/chunks/0'), false)
  assert.equal(matcher.test('/api/uploads/clx0000000000000000001/chunks/25'), false)
  // Die kleinen JSON-Endpunkte dürfen weiterhin durch den Proxy laufen.
  assert.equal(matcher.test('/api/uploads'), true)
  assert.equal(matcher.test('/api/uploads/clx0000000000000000001/complete'), true)
  assert.equal(matcher.test('/api/investigations/clips'), true)
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/chunked-uploads.test.ts`
Expected: FAIL — die Chunk-Route wird noch vom Matcher erfasst, `/api/investigations/clips` noch nicht.

- [ ] **Step 3: Matcher umstellen**

`src/proxy.ts:55` ersetzen:

```ts
  matcher: '/api/((?!uploads/[^/]+/chunks/).*)',
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx tsx --test tests/chunked-uploads.test.ts`
Expected: PASS.

- [ ] **Step 5: Berechtigung je Art ergänzen**

In `src/lib/upload-sessions.ts`:

```ts
import { requireAuth, requirePermission } from './auth'
import { requireTaskModuleManage } from './module-permissions'

/**
 * Genau die Berechtigung, die auch die jeweilige fachliche Route verlangt -
 * geprüft an der Quelle, damit Transport und Einlösen nicht auseinanderlaufen:
 * Clips `src/app/api/investigations/clips/route.ts`, Fotos
 * `src/app/api/investigations/photos/upload/route.ts:28`, Asservate
 * `src/app/api/corruption-checks/[id]/evidence/route.ts:19` (nur Anmeldung),
 * Ressourcen `src/app/api/academy/resources/route.ts:59`.
 */
export async function authorizeUploadKind(kind: UploadKind) {
  if (kind === 'RESOURCE') return requireTaskModuleManage('ACADEMY')
  if (kind === 'EVIDENCE') return requireAuth()
  return requirePermission('investigations:manage')
}
```

`requireAuth()` liefert denselben Nutzer-Typ wie `requirePermission`; falls nicht, in Task 5 den benötigten `id`-Zugriff entsprechend anpassen.

- [ ] **Step 6: Sitzungs-Route anlegen**

`src/app/api/uploads/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { error, success } from '@/lib/api-response'
import { authorizeUploadKind, openUploadSession, UploadSessionError, type UploadKind } from '@/lib/upload-sessions'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  kind: z.enum(['CLIP', 'EVIDENCE', 'PHOTO', 'RESOURCE']),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  totalBytes: z.number().int().positive(),
  fingerprint: z.string().trim().min(1).max(120),
}).strict()

export async function POST(req: NextRequest) {
  try {
    const input = schema.parse(await req.json())
    const user = await authorizeUploadKind(input.kind as UploadKind)
    const session = await openUploadSession({ ...input, kind: input.kind as UploadKind, ownerId: user.id })
    return success(session, session.resumed ? 200 : 201)
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}
```

- [ ] **Step 7: Chunk-Route anlegen**

`src/app/api/uploads/[id]/chunks/[index]/route.ts`:

```ts
import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import {
  authorizeUploadKind,
  loadOwnedSession,
  receivedChunkIndexes,
  storeChunk,
  UploadSessionError,
  type UploadKind,
} from '@/lib/upload-sessions'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'

export const dynamic = 'force-dynamic'
export const OPTIONS = uploadOptions

type Context = { params: Promise<{ id: string; index: string }> }

export async function PUT(req: NextRequest, context: Context) {
  return uploadCors(req, await storeOne(req, context))
}

async function storeOne(req: NextRequest, context: Context) {
  try {
    const { id, index: rawIndex } = await context.params
    const index = Number.parseInt(rawIndex, 10)

    // Ohne Besitzer-Prüfung vor dem Schreiben würden fremde Bytes auf unserer
    // Platte landen, bevor irgendjemand widerspricht.
    const session = await loadOwnedSessionForRequest(id)
    if (session.status !== 'OPEN') return error('Der Upload ist nicht mehr offen', 409)
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.chunkCount) {
      return error('Ungültiger Chunk-Index')
    }

    const digest = req.headers.get('x-chunk-sha256') ?? ''
    if (!req.body) return error('Es wurden keine Daten übertragen')

    const isLast = index === session.chunkCount - 1
    const expectedBytes = isLast
      ? Number(session.totalBytes) - session.chunkSize * index
      : session.chunkSize

    await storeChunk(session.id, index, req.body, digest, expectedBytes)
    const received = await receivedChunkIndexes(session.id)
    return success({ received: received.length, chunkCount: session.chunkCount })
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}

async function loadOwnedSessionForRequest(id: string) {
  // Die Art steht in der Sitzung; die Berechtigung prüfen wir danach passend.
  const session = await loadOwnedSessionUnchecked(id)
  const user = await authorizeUploadKind(session.kind as UploadKind)
  return loadOwnedSession(id, user.id)
}
```

`loadOwnedSessionUnchecked(id)` in `src/lib/upload-sessions.ts` ergänzen: liest die Sitzung ohne Besitzerprüfung, wirft bei Nichtvorhandensein 404 und dient ausschließlich dazu, die zuständige Berechtigung zu bestimmen. Der anschließende `loadOwnedSession` macht die eigentliche Prüfung.

```ts
export async function loadOwnedSessionUnchecked(sessionId: string): Promise<UploadSession> {
  assertSessionId(sessionId)
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  return session
}
```

- [ ] **Step 8: Abschluss- und Abbruch-Route anlegen**

`src/app/api/uploads/[id]/complete/route.ts`:

```ts
import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import {
  assembleUploadSession,
  authorizeUploadKind,
  loadOwnedSessionUnchecked,
  UploadSessionError,
  type UploadKind,
} from '@/lib/upload-sessions'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const session = await loadOwnedSessionUnchecked(id)
    const user = await authorizeUploadKind(session.kind as UploadKind)
    return success(await assembleUploadSession(id, user.id))
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}
```

`src/app/api/uploads/[id]/route.ts` mit `DELETE` analog, ruft `cancelUploadSession(id, user.id)` und antwortet `success({ cancelled: true })`.

- [ ] **Step 9: CORS-Header anpassen**

In `src/lib/upload-cors.ts` die Header-Liste auf `'Authorization,Content-Type,X-Chunk-Sha256'` setzen. Die alten Header (`X-Clip-Meta`, `X-Evidence-Title`, `X-Photo-Title`, `X-Upload-Size`, `X-Discord-Id`) entfallen erst in Task 12 vollständig — hier `X-Chunk-Sha256` nur ergänzen, den Rest stehen lassen.

- [ ] **Step 10: Ende-zu-Ende-Test über echtes HTTP anhängen**

An `tests/chunked-uploads.test.ts` einen Test anhängen, der einen lokalen `http.createServer` startet, die vier Handler nachbildet (wie `tests/large-uploads.test.ts` es für die Schreiber tut), 200 MiB in 8-MiB-Chunks mit drei parallelen Verbindungen und in vertauschter Reihenfolge sendet, abschließt und prüft, dass Größe und SHA-256 der zusammengesetzten Datei mit der Quelle übereinstimmen.

- [ ] **Step 11: Tests laufen lassen**

Run: `npx tsx --test tests/chunked-uploads.test.ts tests/upload-sessions.test.ts`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/app/api/uploads src/lib/upload-sessions.ts src/lib/upload-cors.ts src/proxy.ts tests/chunked-uploads.test.ts
git commit -m "feat: API für wiederaufnehmbare Chunk-Uploads"
```

---

### Task 8: Client-Bibliothek

**Files:**
- Create: `src/lib/chunked-upload.ts`

**Interfaces:**
- Consumes: die Endpunkte aus Task 7.
- Produces:
  - `type UploadKind = 'CLIP' | 'EVIDENCE' | 'PHOTO' | 'RESOURCE'`
  - `interface UploadProgress { sentBytes: number; totalBytes: number; percent: number; bytesPerSecond: number; secondsRemaining: number | null; resumed: boolean }`
  - `uploadInChunks(file: File, kind: UploadKind, options?: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }): Promise<{ uploadId: string; sha256: string; sizeBytes: number }>`
  - `fingerprintFor(file: File): string`

- [ ] **Step 1: Modul anlegen**

`src/lib/chunked-upload.ts`:

```ts
'use client'

export type UploadKind = 'CLIP' | 'EVIDENCE' | 'PHOTO' | 'RESOURCE'

export interface UploadProgress {
  sentBytes: number
  totalBytes: number
  percent: number
  bytesPerSecond: number
  secondsRemaining: number | null
  resumed: boolean
}

const CONCURRENCY = Number.parseInt(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY || '', 10) || 3
const MAX_ATTEMPTS = 3

/** Genügt, um dieselbe Datei bei einem späteren Versuch wiederzuerkennen. */
export function fingerprintFor(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function readJson(response: Response) {
  const parsed = await response.json().catch(() => null)
  if (!response.ok || !parsed?.success) {
    throw new Error(parsed?.error || `Upload fehlgeschlagen (HTTP ${response.status})`)
  }
  return parsed.data
}

export async function uploadInChunks(
  file: File,
  kind: UploadKind,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
) {
  const { onProgress, signal } = options

  const session = await readJson(
    await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify({
        kind,
        originalName: file.name,
        mimeType: file.type,
        totalBytes: file.size,
        fingerprint: fingerprintFor(file),
      }),
    }),
  )

  const { sessionId, chunkSize, chunkCount, received, resumed } = session as {
    sessionId: string
    chunkSize: number
    chunkCount: number
    received: number[]
    resumed: boolean
  }

  const done = new Set<number>(received)
  const startedAt = Date.now()
  let sentBytes = done.size * chunkSize
  if (sentBytes > file.size) sentBytes = file.size

  const report = () => {
    const seconds = (Date.now() - startedAt) / 1000
    // Fortgesetzte Bytes zählen nicht in die Rate - sonst wäre sie am Anfang
    // absurd hoch und die Restzeit unbrauchbar.
    const fresh = Math.max(0, sentBytes - done.size * chunkSize + (done.size - received.length) * chunkSize)
    const rate = seconds > 0 ? fresh / seconds : 0
    onProgress?.({
      sentBytes,
      totalBytes: file.size,
      percent: Math.round((sentBytes / file.size) * 100),
      bytesPerSecond: rate,
      secondsRemaining: rate > 0 ? Math.round((file.size - sentBytes) / rate) : null,
      resumed,
    })
  }
  report()

  const pending = Array.from({ length: chunkCount }, (_, index) => index).filter((index) => !done.has(index))

  const sendOne = async (index: number) => {
    const start = index * chunkSize
    const blob = file.slice(start, Math.min(start + chunkSize, file.size))
    const buffer = await blob.arrayBuffer()
    const digest = await sha256Hex(buffer)

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`/api/uploads/${sessionId}/chunks/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'x-chunk-sha256': digest },
          credentials: 'include',
          signal,
          body: buffer,
        })
        await readJson(response)
        sentBytes += blob.size
        report()
        return
      } catch (cause) {
        if (signal?.aborted) throw cause
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(`Teil ${index + 1} von ${chunkCount} konnte nicht übertragen werden: ${(cause as Error).message}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
      }
    }
  }

  // Feste Zahl an Arbeitern, die sich aus derselben Liste bedienen.
  const queue = [...pending]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        await sendOne(index)
      }
    }),
  )

  const completed = await readJson(
    await fetch(`/api/uploads/${sessionId}/complete`, { method: 'POST', credentials: 'include', signal }),
  )

  return { uploadId: sessionId, sha256: completed.sha256 as string, sizeBytes: completed.sizeBytes as number }
}

export async function cancelUpload(sessionId: string) {
  await fetch(`/api/uploads/${sessionId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
}
```

- [ ] **Step 2: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Fehler in `src/lib/chunked-upload.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chunked-upload.ts
git commit -m "feat: Client-Bibliothek für parallele Chunk-Uploads"
```

---

### Task 9: Clip-Route und Clip-Dialog auf Tickets umstellen

**Files:**
- Modify: `src/app/api/investigations/clips/route.ts:118-220`, `src/components/investigations/clip-upload-dialog.tsx`

**Interfaces:**
- Consumes: `consumeUploadSession` (Task 6), `uploadInChunks` (Task 8).
- Produces: `POST /api/investigations/clips` nimmt JSON `{ uploadId, investigationId, entryId, title, description, location, recordedAt, recordedByAgentId, durationSeconds, tags }`.

- [ ] **Step 1: Route umbauen**

In `uploadClip()` entfallen `parseClipMeta`, die `content-type`-Prüfung, die `content-length`-Prüfung und `saveClipStream`. Stattdessen am Anfang:

```ts
const meta = clipSchema.parse(await req.json())
```

mit einem `zod`-Schema, das die bisherigen Feldprüfungen abbildet (Titel 1–200 Zeichen, `uploadId` Pflicht). Statt `saveClipStream`:

```ts
const stored = await consumeUploadSession(meta.uploadId, user.id, 'CLIP', async (source, extension) => {
  const filename = `${randomUUID()}${extension}`
  const target = resolveClipPath(filename)
  await mkdir(clipDir(), { recursive: true })
  await rename(source, target)
  return filename
})
storedFilename = stored.filename
```

`mimeType: stored.mimeType`, `sizeBytes: BigInt(stored.sizeBytes)` und `originalName: stored.originalName` im `create` verwenden. Der restliche Rumpf — Zugriffsprüfung, Eintrag-/Agent-Prüfung, Audit-Log, `queueClipCompression()`, Discord-Meldung — bleibt unverändert.

`rename` scheitert über Dateisystemgrenzen hinweg mit `EXDEV`. Da `staging` und `clips` beide unter `uploadDir()` liegen, ist das hier nicht zu erwarten; für den Fall trotzdem auf Kopieren-und-Löschen zurückfallen und das im Kommentar festhalten.

- [ ] **Step 2: Dialog umbauen**

In `src/components/investigations/clip-upload-dialog.tsx` `encodeMeta` und den gesamten `XMLHttpRequest`-Block ersetzen:

```ts
const controller = new AbortController()
abortRef.current = controller
const ticket = await uploadInChunks(file, 'CLIP', { signal: controller.signal, onProgress: setProgress })

const response = await fetch('/api/investigations/clips', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    uploadId: ticket.uploadId,
    investigationId,
    entryId: entryId || null,
    title: title.trim(),
    description: description.trim() || null,
    location: location.trim() || null,
    recordedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
    recordedByAgentId: recordedByAgentId || null,
    durationSeconds,
    tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
  }),
})
```

`progress` wird von `number | null` zu `UploadProgress | null`. Die Fortschrittsanzeige zeigt zusätzlich Rate und Restzeit, und bei `progress.resumed` den Hinweis „Fortgesetzt bei X %". Der 413-Sonderfall im alten `onload` entfällt — das Limit greift jetzt schon beim Anlegen der Sitzung mit einer verständlichen Meldung.

- [ ] **Step 3: Typprüfung und Lint**

Run: `npx tsc --noEmit` danach `npm run lint`
Expected: keine Fehler.

- [ ] **Step 4: Im Browser prüfen**

Run: `npm run dev`, eine Ermittlungsakte öffnen, einen Clip von mindestens 50 MB hochladen.
Expected: Balken läuft mit Rate und Restzeit durch, der Clip erscheint in der Akte. Danach die Seite mitten im Upload neu laden, dieselbe Datei erneut wählen: der Dialog meldet „Fortgesetzt bei X %".

- [ ] **Step 5: Commit**

```bash
git add src/app/api/investigations/clips/route.ts src/components/investigations/clip-upload-dialog.tsx
git commit -m "feat: Bodycam-Clips über Chunk-Upload mit Fortsetzen"
```

---

### Task 10: Asservate und Ermittlungsfotos umstellen

**Files:**
- Modify: `src/app/api/corruption-checks/[id]/evidence/route.ts:20-50`, `src/app/api/investigations/photos/upload/route.ts:17-45`, `src/components/corruption/report-tools.tsx`, die Foto-Upload-Stelle in `src/components/investigations/`

**Interfaces:**
- Consumes: Task 6 und 8.
- Produces: beide Routen nehmen JSON `{ uploadId, title, ... }` statt Rohbody.

- [ ] **Step 1: Asservate-Route umstellen**

Der JSON-Zweig für `clipId` bleibt unverändert. Der Datei-Zweig ersetzt `saveEvidence` durch `consumeUploadSession(uploadId, user.id, 'EVIDENCE', …)`, das die Datei nach `evidencePath(filename)` verschiebt. Der `x-evidence-title`-Header entfällt, `title` kommt aus dem JSON-Body.

- [ ] **Step 2: Foto-Route umstellen**

`savePhotoUpload` durch `consumeUploadSession(uploadId, user.id, 'PHOTO', …)` ersetzen; Ziel ist derselbe Pfad, den `savePhotoUpload` heute verwendet. `x-photo-title` entfällt zugunsten von `title` im JSON-Body.

- [ ] **Step 3: Clients umstellen**

Beide Aufrufstellen auf `uploadInChunks(file, 'EVIDENCE' | 'PHOTO', …)` gefolgt von einem JSON-`POST` umstellen, analog zu Task 9 Schritt 2.

- [ ] **Step 4: Typprüfung, Lint und Tests**

Run: `npx tsc --noEmit` danach `npm run lint` danach `npx tsx --test tests/large-uploads.test.ts`
Expected: keine Fehler. Schlägt `large-uploads.test.ts` fehl, weil es `saveEvidence` direkt aufruft: den betroffenen Teil auf `storeChunk` plus `assembleUploadSession` umschreiben, die Prüfung von Größe und SHA-256 dabei beibehalten.

- [ ] **Step 5: Im Browser prüfen**

Run: `npm run dev`, je ein Asservat und ein Ermittlungsfoto hochladen.
Expected: beide erscheinen und lassen sich wieder öffnen.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/corruption-checks src/app/api/investigations/photos src/components tests
git commit -m "feat: Asservate und Ermittlungsfotos über Chunk-Upload"
```

---

### Task 11: Akademie-Ressourcen umstellen

**Files:**
- Modify: `src/app/api/academy/resources/route.ts:57-95`, `src/components/modules/academy-resources.tsx`

**Interfaces:**
- Consumes: Task 6 und 8.
- Produces: die Route nimmt für `type === 'FILE'` JSON mit `uploadId` statt `multipart/form-data`.

- [ ] **Step 1: Route umstellen**

`req.formData()` durch `await req.json()` ersetzen und die Feldauslesung von `text(form, …)` auf ein `zod`-Schema umstellen. Der `LINK`-Zweig bleibt inhaltlich unverändert. Der `FILE`-Zweig ersetzt `saveUploadedFile` durch `consumeUploadSession(uploadId, user.id, 'RESOURCE', …)`, das nach `resolveUploadPath(filename)` verschiebt.

- [ ] **Step 2: Client umstellen**

`new FormData()` entfällt; erst `uploadInChunks(file, 'RESOURCE', …)`, dann der JSON-`POST` mit `uploadId`. Für Links entfällt der Upload-Schritt ganz.

- [ ] **Step 3: Typprüfung, Lint, Browser**

Run: `npx tsc --noEmit` danach `npm run lint` danach `npm run dev`
Expected: eine PDF-Ressource lässt sich anlegen und wieder herunterladen; ein Link ebenso.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/academy/resources/route.ts src/components/modules/academy-resources.tsx
git commit -m "feat: Akademie-Ressourcen über Chunk-Upload"
```

---

### Task 12: Aufräumen, alte Pfade entfernen, Dokumentation

**Files:**
- Modify: `src/lib/clip-compression.ts`, `src/lib/upload-cors.ts`, `src/lib/clips.ts`, `src/lib/corruption-evidence.ts`, `src/lib/investigation-photo-upload.ts`, `src/lib/uploads.ts`, `docs/large-uploads-and-hire-ping.md`
- Test: `tests/upload-sessions.test.ts`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: `cleanupUploadSessions(): Promise<number>` in `src/lib/upload-sessions.ts`, aufgerufen aus dem bestehenden Intervall-Worker.

- [ ] **Step 1: Fehlschlagenden Test anhängen**

```ts
import { cleanupUploadSessions } from '../src/lib/upload-sessions'

test('Der Aufräum-Job entfernt abgelaufene Sitzungen und ihre Teildateien', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const owner = await prisma.user.create({
    data: { username: `t-${randomUUID()}`, displayName: 'Testnutzer', passwordHash: 'x', role: 'ADMIN' },
  })
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  const session = await openUploadSession({
    kind: 'CLIP', ownerId: owner.id, originalName: 'alt.mp4', mimeType: 'video/mp4',
    totalBytes: 4096, fingerprint: 'alt.mp4:4096:1',
  })
  const payload = Buffer.alloc(64, 1)
  await storeChunk(session.sessionId, 0, streamOf(payload), createHash('sha256').update(payload).digest('hex'), payload.length)
  await prisma.uploadSession.update({
    where: { id: session.sessionId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  })

  assert.ok((await cleanupUploadSessions()) >= 1)
  assert.equal(await prisma.uploadSession.findUnique({ where: { id: session.sessionId } }), null)
  assert.deepEqual(await receivedChunkIndexes(session.sessionId), [])
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx tsx --test tests/upload-sessions.test.ts`
Expected: FAIL — `cleanupUploadSessions is not a function`.

- [ ] **Step 3: Aufräum-Funktion ergänzen**

```ts
/**
 * Entfernt, was liegen geblieben ist: abgelaufene und gescheiterte Sitzungen,
 * fertige Uploads, die niemand eingelöst hat, und verwaiste Chunk-Ordner ohne
 * zugehörige Zeile. Hängengebliebenes ASSEMBLING läuft über die abgelaufene
 * Lease beim nächsten Abschlussversuch von selbst wieder an.
 */
export async function cleanupUploadSessions(): Promise<number> {
  const now = new Date()
  const stale = await prisma.uploadSession.findMany({
    where: { expiresAt: { lt: now }, status: { in: ['OPEN', 'FAILED', 'DONE'] } },
    select: { id: true, storedFilename: true },
    take: 50,
  })

  for (const session of stale) {
    await rm(incomingDir(session.id), { recursive: true, force: true })
    if (session.storedFilename) {
      await unlink(stagedPath(session.id, path.extname(session.storedFilename))).catch(() => {})
    }
    await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {})
  }

  const base = path.join(/*turbopackIgnore: true*/ uploadDir(), 'incoming')
  const orphans = await readdir(base).catch(() => [] as string[])
  for (const name of orphans) {
    if (await prisma.uploadSession.findUnique({ where: { id: name }, select: { id: true } })) continue
    await rm(path.join(/*turbopackIgnore: true*/ base, name), { recursive: true, force: true })
  }

  return stale.length
}
```

- [ ] **Step 4: In den bestehenden Worker einhängen**

In `src/lib/clip-compression.ts` dort, wo `cleanOriginals()` im Intervall aufgerufen wird, `cleanupUploadSessions()` mit aufnehmen — mit eigenem `catch`, damit ein Fehler beim Aufräumen die Komprimierung nicht anhält.

- [ ] **Step 5: Tote Pfade entfernen**

- `saveClipStream` aus `src/lib/clips.ts`, `saveEvidence` aus `src/lib/corruption-evidence.ts`, `savePhotoUpload` und `discardPhotoUpload` aus `src/lib/investigation-photo-upload.ts`, `saveUploadedFile` aus `src/lib/uploads.ts` löschen, sofern kein Aufrufer mehr existiert.
- In `src/lib/upload-cors.ts` die Header-Liste auf `'Authorization,Content-Type,X-Chunk-Sha256'` reduzieren.
- Prüfen mit: `grep -rn "saveClipStream\|saveEvidence\|savePhotoUpload\|saveUploadedFile\|x-clip-meta\|x-upload-size\|x-evidence-title\|x-photo-title" src tests`
  Expected: keine Treffer außer in gelöschten Zeilen.

- [ ] **Step 6: Dokumentation aktualisieren**

`docs/large-uploads-and-hire-ping.md`: den Abschnitt „Upload-Korrektur" ersetzen. Beschreiben: das Chunk-Verfahren, die neuen Umgebungsvariablen `UPLOAD_CHUNK_BYTES` und `NEXT_PUBLIC_UPLOAD_CONCURRENCY`, das 24-Stunden-Fenster fürs Fortsetzen, das Kontingent von 3 offenen Sitzungen und den Hinweis, dass die nginx-Werte aus `scripts/fix-nginx-uploads.sh` nun nicht mehr nötig, aber weiterhin sinnvoll sind.

- [ ] **Step 7: Gesamten Testlauf**

Run: `npx tsx --test tests/upload-sessions.test.ts tests/chunked-uploads.test.ts tests/large-uploads.test.ts tests/clip-transcode.test.ts` danach `npx tsc --noEmit` danach `npm run lint` danach `npm run build`
Expected: alles grün.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Aufräum-Job für Upload-Sitzungen, alte Rohbody-Pfade entfernt"
```

---

## Self-Review

**Spec-Abdeckung:** Datenmodell → Task 1. Signaturprüfung → Task 2. Chunk-Ablage und Fortschritt aus dem Dateisystem → Task 3, 4. Sitzung anlegen/wiederfinden, Kontingent, Besitzerbindung → Task 5. Zusammensetzen, Prüfsumme, Ticket → Task 6. Protokoll und Proxy-Matcher → Task 7. Parallelität, Wiederholversuche, Rate/Restzeit → Task 8. Die vier fachlichen Wege → Task 9, 10, 11. Aufräumen, Entfernen der alten Pfade, Doku → Task 12.

**Berechtigungen:** in den vier Routen nachgeschlagen, nicht geraten — Clips und Fotos `requirePermission('investigations:manage')`, Asservate `requireAuth()` (nur Anmeldung), Ressourcen `requireTaskModuleManage('ACADEMY')` aus `@/lib/module-permissions`. `authorizeUploadKind` in Task 7 bildet genau das ab. Wichtig ist, dass die Prüfung beim Anlegen der Sitzung dieselbe ist wie beim Einlösen; sonst könnte jemand Bytes hochladen, die er anschließend nicht verwenden darf.

**Keine offenen Punkte.**

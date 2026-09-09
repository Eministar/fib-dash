# Karte ↔ Akten, Bild-Upload und Akten-Wizard – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartenpunkte lassen sich mit Dauer- und Einsatzakten verknüpfen, Bilder lassen sich in den Bildkatalog hochladen, und beide Akten werden über einen Mehrschritt-Wizard angelegt, bei dem der Verschlusssache-Haken vorangekreuzt ist.

**Architecture:** Drei implizite Prisma-m:n-Relationen (`DossierMapSpots`, `InvestigationMapSpots`, `InvestigationPhotos`) im Stil der vorhandenen `DossierPersons`. Der Upload legt ein ganz normales `InvestigationPhoto` an – dieselbe Tabelle und dasselbe Verzeichnis wie der Discord-Sync, nur ohne Discord-Felder. Ein generischer `Wizard` trägt beide Anlegen-Flows, ein `SpotPicker` wiederverwendet die bestehende `CityMap` im Auswahlmodus.

**Tech Stack:** Next.js 15 App Router, Prisma 7 auf MariaDB, React 19, Zod, Tailwind, Radix, `node:test` über `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-09-karte-akten-wizard-design.md`

## Global Constraints

- **Sprache:** Alle UI-Texte, Fehlermeldungen und Kommentare auf Deutsch. Kommentare erklären das *Warum*, nicht das *Was* – siehe bestehende Dateien.
- **Bildlimit:** 20 MB (`20 * 1024 * 1024`), identisch zum Discord-Import in `src/lib/investigation-photos.ts`.
- **Unterstützte Bildformate:** JPG, PNG, WebP, GIF – bestimmt ausschließlich über `detectPhotoType()` anhand der Magic Bytes, niemals über einen vom Client geschickten `Content-Type`.
- **Rechte:** Bild-Upload und Aktenpflege = `investigations:manage`. Kartenpunkt anlegen = `map:manage`. Kartenpunkte lesen = `map:view`.
- **Sichtbarkeit:** Verknüpfte Einsatzakten laufen überall durch `investigationVisibilityWhere(user)` bzw. `canAccessInvestigation(user, …)`. Kartenpunkte selbst bleiben für alle mit `map:view` sichtbar.
- **Prisma-Defaults bleiben unverändert:** `Investigation.classified` behält `@default(false)`. Nur das Formular kreuzt vor.
- **Tests laufen mit:** `npx tsx --test tests/<datei>.test.ts` (siehe `package.json`, Muster `test:codenames`).
- **Typprüfung:** `npx tsc --noEmit` muss nach jeder Aufgabe sauber sein.
- **Kein zweiter Bildpfad:** Uploads erzeugen `InvestigationPhoto`-Zeilen. Keine neue Bildtabelle, kein neues Bildverzeichnis.

---

### Task 1: Schema um Verknüpfungen und Upload-Felder erweitern

**Files:**
- Modify: `prisma/schema.prisma` (Modelle `User`, `Investigation`, `InvestigationPhoto`, `Dossier`, `MapSpot`)

**Interfaces:**
- Consumes: nichts
- Produces: Prisma-Client-Felder `Dossier.mapSpots`, `Investigation.mapSpots`, `Investigation.photos`, `MapSpot.dossiers`, `MapSpot.investigations`, `InvestigationPhoto.uploadedById`, `InvestigationPhoto.uploadedBy`, `InvestigationPhoto.investigations`, `User.photosUploaded`. `InvestigationPhoto.sourceKey`, `.channelId` und `.messageId` sind ab hier nullable.

- [ ] **Step 1: `InvestigationPhoto` für Uploads öffnen**

In `prisma/schema.prisma` das Modell `InvestigationPhoto` (ab Zeile ~1961) ersetzen durch:

```prisma
model InvestigationPhoto {
  id String @id @default(cuid())
  /// Discord-Herkunft. `null` bedeutet: das Bild wurde hochgeladen.
  sourceKey String? @unique @db.VarChar(191)
  channelId String? @db.VarChar(30)
  messageId String? @db.VarChar(30)
  title     String  @db.VarChar(200)
  filename  String  @unique @db.VarChar(80)
  mimeType  String  @db.VarChar(80)
  sizeBytes Int
  createdAt DateTime @default(now())

  /// Nur bei Uploads gesetzt; beim Discord-Import bleibt das Feld leer.
  uploadedById String?
  uploadedBy   User?   @relation("PhotoUploader", fields: [uploadedById], references: [id], onDelete: SetNull)

  dossiers       Dossier[]
  investigations Investigation[] @relation("InvestigationPhotos")

  @@index([createdAt])
  @@index([uploadedById])
}
```

- [ ] **Step 2: Gegenseite auf `User` ergänzen**

Im Modell `User` neben die vorhandene Zeile `mapSpotsCreated MapSpot[] @relation("MapSpotCreator")` (Zeile ~190) einfügen:

```prisma
  photosUploaded    InvestigationPhoto[] @relation("PhotoUploader")
```

- [ ] **Step 3: Relationen auf `Investigation`, `Dossier` und `MapSpot` ergänzen**

Im Modell `Investigation` neben die vorhandene Zeile `dossiers Dossier[] @relation("DossierInvestigations")` (Zeile ~1585):

```prisma
  mapSpots MapSpot[]            @relation("InvestigationMapSpots")
  photos   InvestigationPhoto[] @relation("InvestigationPhotos")
```

Im Modell `Dossier` neben `vehicles Vehicle[] @relation("DossierVehicles")`:

```prisma
  mapSpots       MapSpot[]           @relation("DossierMapSpots")
```

Im Modell `MapSpot` vor `createdById`:

```prisma
  dossiers       Dossier[]       @relation("DossierMapSpots")
  investigations Investigation[] @relation("InvestigationMapSpots")
```

- [ ] **Step 4: Schema validieren**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Bei „Error validating field … missing an opposite relation field": eine der Gegenseiten aus Step 2/3 fehlt.

- [ ] **Step 5: Datenbank angleichen und Client neu erzeugen**

Run: `npm run db:push`
Expected: legt zuerst ein Backup an, dann „Your database is now in sync with your Prisma schema."; danach `npx prisma generate`.

Run: `npx prisma generate`
Expected: „Generated Prisma Client".

- [ ] **Step 6: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe. `importMessage()` in `src/lib/investigation-photos.ts` setzt `sourceKey`, `channelId` und `messageId` weiterhin – nullable Felder brechen das nicht.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: Relationen für Kartenpunkte, Aktenbilder und Bild-Uploads im Schema"
```

---

### Task 2: Bild-Upload in den Katalog (Library + Route)

**Files:**
- Create: `src/lib/investigation-photo-upload.ts`
- Create: `src/app/api/investigations/photos/upload/route.ts`
- Modify: `src/lib/investigation-photos.ts` (Konstante exportieren)
- Modify: `src/lib/upload-cors.ts` (Header erlauben)
- Create: `tests/photo-upload.test.ts`

**Interfaces:**
- Consumes: `detectPhotoType(bytes)` und `photoPath(filename)` aus `src/lib/investigation-photos.ts`, `uploadDir()` aus `src/lib/uploads.ts`.
- Produces:
  - `MAX_PHOTO_UPLOAD_BYTES: number` (= 20 971 520)
  - `class PhotoUploadError extends Error { constructor(message: string, status?: number) }` mit `readonly status: number`
  - `savePhotoUpload(body: ReadableStream<Uint8Array>, expectedSize?: number): Promise<{ filename: string; mimeType: string; sizeBytes: number }>`
  - `photoUploadRouteError(cause: unknown): Response`
  - Route `POST /api/investigations/photos/upload` → `{ success: true, data: { id, title, url } }` mit Status 201. Header: `x-photo-title` (URL-kodiert), optional `x-upload-size`.

- [ ] **Step 1: Größenlimit aus `investigation-photos.ts` exportierbar machen**

In `src/lib/investigation-photos.ts` die Zeile

```ts
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
```

ersetzen durch:

```ts
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
```

- [ ] **Step 2: Failing test schreiben**

`tests/photo-upload.test.ts` neu anlegen:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Jeder Testlauf bekommt ein eigenes Upload-Verzeichnis. `uploadDir()`
 *  liest die Variable bei jedem Aufruf, deshalb reicht das Setzen hier. */
const workspace = await mkdtemp(path.join(tmpdir(), 'fib-photo-'))
process.env.UPLOAD_DIR = workspace

const { MAX_PHOTO_UPLOAD_BYTES, PhotoUploadError, savePhotoUpload } = await import('../src/lib/investigation-photo-upload')
const { photoPath } = await import('../src/lib/investigation-photos')

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function streamOf(...parts: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new Uint8Array(part))
      controller.close()
    },
  })
}

test('Ein PNG landet unter zufälligem Namen im Bildverzeichnis', async () => {
  const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(64, 7)])
  const saved = await savePhotoUpload(streamOf(payload))
  assert.equal(saved.mimeType, 'image/png')
  assert.equal(saved.sizeBytes, payload.length)
  assert.match(saved.filename, /^[a-f0-9-]{36}\.png$/)
  assert.deepEqual(await readFile(photoPath(saved.filename)), payload)
})

test('Der Dateityp kommt aus den Magic Bytes, nicht aus dem Dateinamen', async () => {
  const svg = Buffer.from('<svg onload="evil()"/>')
  await assert.rejects(savePhotoUpload(streamOf(svg)), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.match(cause.message, /JPG, PNG, WebP und GIF/)
    return true
  })
})

test('Ein leerer Upload wird abgewiesen', async () => {
  await assert.rejects(savePhotoUpload(streamOf()), /Datei fehlt/)
})

test('Zu große Bilder werden mit 413 abgewiesen – angekündigt wie tatsächlich', async () => {
  await assert.rejects(savePhotoUpload(streamOf(PNG_HEADER), MAX_PHOTO_UPLOAD_BYTES + 1), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.equal(cause.status, 413)
    return true
  })
  const oversized = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_PHOTO_UPLOAD_BYTES, 1)])
  await assert.rejects(savePhotoUpload(streamOf(oversized)), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.equal(cause.status, 413)
    return true
  })
})

test('Eine abgebrochene Übertragung wird erkannt und hinterlässt keine Datei', async () => {
  const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(16, 3)])
  await assert.rejects(savePhotoUpload(streamOf(payload), payload.length + 10), /unvollständig/)
})

test('Unsinnige Größenangaben werden abgewiesen', async () => {
  for (const size of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(savePhotoUpload(streamOf(PNG_HEADER), size), /Dateigröße/)
  }
})

test.after(async () => { await rm(workspace, { recursive: true, force: true }) })
```

- [ ] **Step 3: Test laufen lassen und Fehlschlag prüfen**

Run: `npx tsx --test tests/photo-upload.test.ts`
Expected: FAIL – `Cannot find module '../src/lib/investigation-photo-upload'`.

- [ ] **Step 4: Upload-Library schreiben**

`src/lib/investigation-photo-upload.ts` neu anlegen:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { MAX_IMAGE_BYTES, detectPhotoType, photoPath } from './investigation-photos'

/** Dasselbe Limit wie beim Discord-Import – ein Bild soll nicht davon
 *  abhängen, auf welchem Weg es in den Katalog kommt. */
export const MAX_PHOTO_UPLOAD_BYTES = MAX_IMAGE_BYTES

export class PhotoUploadError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const TOO_LARGE = 'Bild zu groß (max. 20 MB)'

/**
 * Nimmt einen rohen Upload-Stream entgegen und legt ihn als Katalogbild ab.
 * Der Typ wird ausschließlich aus den Magic Bytes bestimmt: ein vom Client
 * geschickter `Content-Type` darf nicht entscheiden, was auf der Platte landet.
 */
export async function savePhotoUpload(body: ReadableStream<Uint8Array>, expectedSize?: number) {
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)) {
    throw new PhotoUploadError('Ungültige Dateigröße')
  }
  if (expectedSize !== undefined && expectedSize > MAX_PHOTO_UPLOAD_BYTES) {
    throw new PhotoUploadError(TOO_LARGE, 413)
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let sizeBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sizeBytes += value.length
      // Abbruch, sobald das Limit reißt – nicht erst, wenn alles im Speicher liegt.
      if (sizeBytes > MAX_PHOTO_UPLOAD_BYTES) {
        await reader.cancel()
        throw new PhotoUploadError(TOO_LARGE, 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (!sizeBytes) throw new PhotoUploadError('Datei fehlt')
  if (expectedSize !== undefined && sizeBytes !== expectedSize) {
    throw new PhotoUploadError('Upload unvollständig. Bitte erneut hochladen.')
  }

  const bytes = Buffer.concat(chunks)
  const type = detectPhotoType(bytes)
  if (!type) throw new PhotoUploadError('Unterstützt werden JPG, PNG, WebP und GIF.')

  const filename = `${randomUUID()}.${type.extension}`
  const target = photoPath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes, { flag: 'wx' })
  return { filename, mimeType: type.mimeType, sizeBytes }
}

/** Entfernt eine Datei, deren Datenbankzeile nicht zustande kam. */
export async function discardPhotoUpload(filename: string) {
  await unlink(photoPath(filename)).catch(() => {})
}

export function photoUploadRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof PhotoUploadError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error('Beschriftung fehlt oder ist zu lang')
  console.error('[PhotoUpload]', cause)
  return error('Bild konnte nicht gespeichert werden', 500)
}
```

- [ ] **Step 5: Test laufen lassen und Erfolg prüfen**

Run: `npx tsx --test tests/photo-upload.test.ts`
Expected: PASS, 6 Tests.

- [ ] **Step 6: Upload-Header für CORS freigeben**

In `src/lib/upload-cors.ts` die `Access-Control-Allow-Headers`-Zeile erweitern um `X-Photo-Title`:

```ts
    response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Clip-Meta,X-Evidence-Title,X-Photo-Title,X-Upload-Size,X-Discord-Id')
```

- [ ] **Step 7: Route schreiben**

`src/app/api/investigations/photos/upload/route.ts` neu anlegen. Das Muster ist bewusst identisch zu `src/app/api/corruption-checks/[id]/evidence/route.ts`: Rohbody statt `FormData`, weil Nexts Body-Klonen bei großen Uploads sonst doppelt Speicher zieht.

```ts
import { z } from 'zod'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  PhotoUploadError,
  discardPhotoUpload,
  photoUploadRouteError,
  savePhotoUpload,
} from '@/lib/investigation-photo-upload'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'

export const dynamic = 'force-dynamic'
export const OPTIONS = uploadOptions

export async function POST(req: Request) {
  return uploadCors(req, await uploadPhoto(req))
}

async function uploadPhoto(req: Request) {
  let stored: string | undefined
  try {
    const user = await requirePermission('investigations:manage')
    if (!req.body) throw new PhotoUploadError('Datei fehlt')

    const title = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(decodeURIComponent(req.headers.get('x-photo-title') ?? ''))
    const expected = req.headers.get('x-upload-size') ?? req.headers.get('content-length')
    const file = await savePhotoUpload(req.body, expected === null ? undefined : Number(expected))
    stored = file.filename

    const photo = await prisma.$transaction(async (tx) => {
      const created = await tx.investigationPhoto.create({
        data: { ...file, title, uploadedById: user.id },
      })
      await createAuditLog(
        { action: 'PHOTO_UPLOADED', userId: user.id, details: `Bildkatalog: „${title}“` },
        tx,
      )
      return created
    })
    stored = undefined

    return success(
      { id: photo.id, title: photo.title, url: `/api/investigations/photos/${photo.id}/image` },
      201,
    )
  } catch (cause) {
    // Erst löschen, wenn feststeht, dass keine Zeile auf die Datei zeigt.
    if (stored) {
      try {
        if (!(await prisma.investigationPhoto.findUnique({ where: { filename: stored } }))) {
          await discardPhotoUpload(stored)
        }
      } catch {
        /* Möglicherweise referenzierte Bytes bleiben lieber liegen. */
      }
    }
    return photoUploadRouteError(cause)
  }
}
```

- [ ] **Step 8: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 9: Commit**

```bash
git add src/lib/investigation-photo-upload.ts src/lib/investigation-photos.ts src/lib/upload-cors.ts src/app/api/investigations/photos/upload/route.ts tests/photo-upload.test.ts
git commit -m "feat: Bilder lassen sich in den Bildkatalog hochladen"
```

---

### Task 3: Bildkatalog-UI – Upload-Button und Mehrfachauswahl

**Files:**
- Modify: `src/components/investigations/photo-catalog.tsx`

**Interfaces:**
- Consumes: `POST /api/investigations/photos/upload` aus Task 2.
- Produces:
  - `PhotoUploadButton({ onUploaded }: { onUploaded: (photo: CatalogPhoto) => void })`
  - `PhotoGrid` bekommt zwei neue optionale Props: `selectedIds?: string[]` und `onUpload?: (photo: CatalogPhoto) => void`
  - `PhotoPicker({ value, onChange }: { value: CatalogPhoto[]; onChange: (photos: CatalogPhoto[]) => void })` – Mehrfachauswahl inklusive Upload, wird in Task 9 und 11 verwendet.

- [ ] **Step 1: Upload-Button ergänzen**

In `src/components/investigations/photo-catalog.tsx` die Imports erweitern und die Komponente einfügen. `useApi` scheidet aus, weil es jeden Request auf `Content-Type: application/json` festnagelt – der Upload schickt aber rohe Bytes.

Imports oben ergänzen:

```ts
import { useRef } from 'react'
import { Upload } from 'lucide-react'
```

Danach unterhalb von `PhotoGrid` einfügen:

```tsx
/** Rohbody-Upload statt `useApi`: der Hook erzwingt `application/json`. */
export function PhotoUploadButton({ onUploaded }: { onUploaded: (photo: CatalogPhoto) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const upload = async (file: File) => {
    setBusy(true)
    setFailure('')
    try {
      const response = await fetch('/api/investigations/photos/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-photo-title': encodeURIComponent(file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'Upload'),
          'x-upload-size': String(file.size),
        },
        body: file,
      })
      const parsed = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; data?: CatalogPhoto }
        | null
      if (!response.ok || !parsed?.success || !parsed.data) {
        throw new Error(parsed?.error || `Upload fehlgeschlagen (HTTP ${response.status})`)
      }
      onUploaded(parsed.data)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Upload fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => inputRef.current?.click()}>
        <Upload size={14} />
        Bild hochladen
      </Button>
      {failure && <p role="alert" className="text-xs text-red-300">{failure}</p>}
    </div>
  )
}
```

- [ ] **Step 2: `PhotoGrid` um Auswahlmarkierung und Upload erweitern**

Signatur und Rumpf von `PhotoGrid` anpassen:

```tsx
export function PhotoGrid({ onSelect, selectedIds = [], onUpload }: { onSelect?: (photo: CatalogPhoto) => void; selectedIds?: string[]; onUpload?: (photo: CatalogPhoto) => void }) {
```

Direkt nach dem Such-`Input` einfügen:

```tsx
    {onUpload && <PhotoUploadButton onUploaded={(photo) => { onUpload(photo); setPage(1); setSearch('') }} />}
```

Am `<button>` der Kachel die Klassen um eine Auswahlmarkierung ergänzen – aus

```tsx
className="overflow-hidden rounded-xl border border-[#343434] bg-[#181818] text-left hover:border-[#a78bfa] focus-visible:outline-2 focus-visible:outline-[#a78bfa]"
```

wird

```tsx
className={cn(
  'overflow-hidden rounded-xl border bg-[#181818] text-left hover:border-[#a78bfa] focus-visible:outline-2 focus-visible:outline-[#a78bfa]',
  selectedIds.includes(photo.id) ? 'border-[#a78bfa] ring-2 ring-[#a78bfa]/40' : 'border-[#343434]',
)}
aria-pressed={selectedIds.includes(photo.id)}
```

und oben `import { cn } from '@/lib/utils'` ergänzen.

Der leere Zustand nennt jetzt beide Quellen – der bisherige Text behauptet, Bilder kämen nur aus Discord:

```tsx
<p className="py-8 text-sm text-[#909090]">Noch keine passenden Bilder. Lade eines hoch oder poste es im eingerichteten Discord-Channel.</p>
```

- [ ] **Step 3: `PhotoField` um den Upload-Button ergänzen**

In `PhotoField` die Button-Zeile ersetzen:

```tsx
    {!readOnly && <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Aus Bildkatalog wählen</Button>
      <PhotoUploadButton onUploaded={(photo) => onChange(photo)} />
      {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Foto entfernen</Button>}
    </div>}
```

- [ ] **Step 4: `PhotoPicker` für Mehrfachauswahl ergänzen**

Unterhalb von `PhotoField` einfügen:

```tsx
/** Mehrfachauswahl für Akten, die mehrere Bilder führen. Ein Upload wird
 *  sofort mit ausgewählt – sonst müsste man ihn direkt danach suchen. */
export function PhotoPicker({ value, onChange }: { value: CatalogPhoto[]; onChange: (photos: CatalogPhoto[]) => void }) {
  const [open, setOpen] = useState(false)
  const toggle = (photo: CatalogPhoto) =>
    onChange(value.some((entry) => entry.id === photo.id) ? value.filter((entry) => entry.id !== photo.id) : [...value, photo])

  return <div className="space-y-3">
    {value.length === 0
      ? <div className="flex h-24 items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 text-sm text-[#808080]"><ImageIcon size={20} />Noch keine Bilder ausgewählt</div>
      : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{value.map((photo) => <div key={photo.id} className="relative overflow-hidden rounded-lg border border-[#343434]">
          <Image unoptimized src={photo.url} alt={photo.title} width={200} height={150} className="aspect-[4/3] w-full object-cover" />
          <button type="button" aria-label={`${photo.title} entfernen`} onClick={() => toggle(photo)} className="absolute right-1 top-1 rounded bg-[#111111]/80 px-1.5 text-xs text-[#fca5a5]">×</button>
        </div>)}</div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Bilder auswählen</Button>
      <PhotoUploadButton onUploaded={(photo) => onChange([...value, photo])} />
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="Bilder auswählen" size="xl">
      <PhotoGrid selectedIds={value.map((photo) => photo.id)} onSelect={toggle} onUpload={(photo) => onChange([...value, photo])} />
      <div className="mt-4 flex justify-end"><Button type="button" onClick={() => setOpen(false)}>Fertig ({value.length})</Button></div>
    </Modal>
  </div>
}
```

- [ ] **Step 5: Katalogseite den Upload anbieten lassen**

In `PhotoCatalogPage` das abschließende `<PhotoGrid key={revision} />` ersetzen durch:

```tsx
<PhotoGrid key={revision} onUpload={() => setRevision((value) => value + 1)} />
```

Damit hat auch die Katalogseite selbst einen Upload und nicht nur den Discord-Abgleich.

- [ ] **Step 6: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 7: Manuell prüfen**

Run: `npm run dev`, dann `/investigations/photos` öffnen, ein PNG hochladen.
Expected: Das Bild erscheint sofort im Raster; ein Reload zeigt es weiterhin.
Danach eine `.txt`-Datei mit erzwungener Auswahl („Alle Dateien") hochladen.
Expected: Fehlermeldung „Unterstützt werden JPG, PNG, WebP und GIF."

- [ ] **Step 8: Commit**

```bash
git add src/components/investigations/photo-catalog.tsx
git commit -m "feat: Bildkatalog mit Upload-Button und Mehrfachauswahl"
```

---

### Task 4: Kartenpunkte liefern ihre verknüpften Akten mit

**Files:**
- Modify: `src/lib/map-spots.ts` (Typ `MapSpot`)
- Modify: `src/lib/map-server.ts` (`spotInclude`, `serializeSpot`)
- Modify: `src/app/api/map/spots/route.ts` (GET)
- Create: `tests/map-spot-links.test.ts`

**Interfaces:**
- Consumes: `investigationVisibilityWhere(user)` aus `src/lib/investigations.ts`.
- Produces:
  - `MapSpot` (Typ in `src/lib/map-spots.ts`) hat zwei neue Felder:
    ```ts
    dossiers: { id: string; title: string; kind: string }[]
    investigations: { id: string; caseNumber: string; title: string; classified: boolean }[]
    ```
  - `spotInclude` enthält `dossiers` und `investigations`.
  - `serializeSpot(spot)` füllt beide Felder.
  - `visibleSpotInclude(user)` in `src/lib/map-server.ts`: liefert `spotInclude` mit sichtbarkeitsgefiltertem `investigations`-Zweig.

- [ ] **Step 1: Failing test schreiben**

`tests/map-spot-links.test.ts` neu anlegen:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serializeSpot, visibleSpotInclude } from '../src/lib/map-server'

const baseUser = { id: 'user-1', discordId: null, permissions: [] as string[], roles: [] as unknown[] }

test('Ohne Sonderrecht filtert der Include Verschlusssachen auf sichtbare Akten', () => {
  const include = visibleSpotInclude({ ...baseUser } as never)
  const where = include.investigations.where as { OR?: unknown[] }
  assert.ok(Array.isArray(where.OR), 'Die Sichtbarkeitsbedingung muss durchgereicht werden')
  assert.ok(JSON.stringify(where).includes('"classified":false'))
})

test('Mit investigations:classified bleibt der Include ungefiltert', () => {
  const include = visibleSpotInclude({ ...baseUser, permissions: ['investigations:classified'] } as never)
  assert.deepEqual(include.investigations.where, {})
})

test('serializeSpot reicht verknüpfte Akten in stabiler Form nach außen', () => {
  const spot = serializeSpot({
    id: 'spot-1', title: 'Sammler Nord', description: '', category: 'weed', icon: null,
    x: 10, y: 20, createdById: null, createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
    dossiers: [{ id: 'd1', title: 'Familie Moretti', kind: 'FAMILY' }],
    investigations: [{ id: 'i1', caseNumber: 'ERM-0001', title: 'Waffenhandel', classified: true }],
  } as never)
  assert.deepEqual(spot.dossiers, [{ id: 'd1', title: 'Familie Moretti', kind: 'FAMILY' }])
  assert.deepEqual(spot.investigations, [{ id: 'i1', caseNumber: 'ERM-0001', title: 'Waffenhandel', classified: true }])
  assert.equal(spot.createdByName, 'Unbekannt')
})
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag prüfen**

Run: `npx tsx --test tests/map-spot-links.test.ts`
Expected: FAIL – `visibleSpotInclude` existiert nicht.

- [ ] **Step 3: Typ `MapSpot` erweitern**

In `src/lib/map-spots.ts` das Interface `MapSpot` um zwei Felder ergänzen (direkt nach `y: number`):

```ts
  /** Dauerakten, die diesen Punkt als Route, Sammler oder Anwesen führen. */
  dossiers: { id: string; title: string; kind: string }[]
  /** Einsatzakten, die an diesem Punkt stattfanden – bereits sichtbarkeitsgefiltert. */
  investigations: { id: string; caseNumber: string; title: string; classified: boolean }[]
```

- [ ] **Step 4: `map-server.ts` erweitern**

Import ergänzen:

```ts
import { investigationVisibilityWhere } from './investigations'
import type { CurrentUser } from './auth'
```

(Falls `CurrentUser` in `src/lib/auth.ts` anders heißt: den Typ verwenden, den `investigationVisibilityWhere` als Parameter erwartet.)

`spotInclude` ersetzen durch:

```ts
export const spotInclude = {
  createdBy: { select: { id: true, displayName: true } },
  dossiers: { select: { id: true, title: true, kind: true }, orderBy: { title: 'asc' } },
  investigations: { select: { id: true, caseNumber: true, title: true, classified: true }, orderBy: { caseNumber: 'asc' } },
} satisfies Prisma.MapSpotInclude

/**
 * Wie `spotInclude`, aber Verschlusssachen werden für Unbefugte
 * herausgefiltert. Der Punkt selbst bleibt sichtbar: verschwände er,
 * verriete genau dieses Verschwinden die geheime Verknüpfung.
 */
export function visibleSpotInclude(user: CurrentUser) {
  return {
    ...spotInclude,
    investigations: { ...spotInclude.investigations, where: investigationVisibilityWhere(user) },
  }
}
```

In `serializeSpot` vor `createdById` ergänzen:

```ts
    dossiers: spot.dossiers?.map((entry) => ({ id: entry.id, title: entry.title, kind: entry.kind })) ?? [],
    investigations: spot.investigations?.map((entry) => ({ id: entry.id, caseNumber: entry.caseNumber, title: entry.title, classified: entry.classified })) ?? [],
```

Der `?? []`-Zweig deckt den POST- und PATCH-Pfad ab, falls dort einmal ohne die Relationen geladen wird.

- [ ] **Step 5: GET-Route auf den gefilterten Include umstellen**

In `src/app/api/map/spots/route.ts` die GET-Funktion ersetzen:

```ts
export async function GET() {
  try {
    const user = await requirePermission('map:view')
    const spots = await prisma.mapSpot.findMany({
      include: visibleSpotInclude(user),
      orderBy: { createdAt: 'desc' },
    })
    return success(spots.map(serializeSpot))
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}
```

Import anpassen: `visibleSpotInclude` zusätzlich aus `@/lib/map-server` holen.

- [ ] **Step 6: Test laufen lassen und Erfolg prüfen**

Run: `npx tsx --test tests/map-spot-links.test.ts`
Expected: PASS, 3 Tests.

- [ ] **Step 7: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 8: Commit**

```bash
git add src/lib/map-spots.ts src/lib/map-server.ts src/app/api/map/spots/route.ts tests/map-spot-links.test.ts
git commit -m "feat: Kartenpunkte liefern verknüpfte Akten sichtbarkeitsgefiltert mit"
```

---

### Task 5: Dauerakten nehmen Kartenpunkte auf

**Files:**
- Modify: `src/lib/dossiers-server.ts` (`dossierSchema`, `saveDossier`)
- Modify: `src/app/api/investigations/dossiers/route.ts` und `src/app/api/investigations/dossiers/[id]/route.ts` (Include)
- Modify: `tests/investigation-media.test.ts`

**Interfaces:**
- Consumes: Prisma-Feld `Dossier.mapSpots` aus Task 1.
- Produces: `dossierSchema` akzeptiert `mapSpotIds?: string[]` (max. 200). `saveDossier` setzt die Verknüpfung per `set`-Semantik. Die Dossier-API liefert `mapSpots: { id, title, category, icon, x, y }[]`.

- [ ] **Step 1: Failing test schreiben**

In `tests/investigation-media.test.ts` an den Test `'Dossiers accept fixed categories and reject invalid or unbounded fields'` anschließen:

```ts
test('Dossiers nehmen Kartenpunkte an und begrenzen ihre Zahl', () => {
  const parsed = dossierSchema.parse({ title: 'Familie Moretti', kind: 'FAMILY', mapSpotIds: ['spot-1', 'spot-2'] })
  assert.deepEqual(parsed.mapSpotIds, ['spot-1', 'spot-2'])
  assert.equal(dossierSchema.safeParse({ title: 'A', kind: 'FAMILY', mapSpotIds: Array(201).fill('x') }).success, false)
  assert.equal(dossierSchema.safeParse({ title: 'A', kind: 'FAMILY', mapSpotIds: [''] }).success, false)
})
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag prüfen**

Run: `npx tsx --test tests/investigation-media.test.ts`
Expected: FAIL – `mapSpotIds` ist `undefined`, weil `.strict()` das unbekannte Feld verwirft bzw. der Parse scheitert.

- [ ] **Step 3: Schema erweitern**

In `src/lib/dossiers-server.ts` in `dossierSchema` nach `vehicleIds` ergänzen:

```ts
  mapSpotIds: z.array(id).max(200).optional(),
```

- [ ] **Step 4: `saveDossier` erweitern**

In `saveDossier` nach dem `vehicleIds`-Block einfügen:

```ts
    const mapSpotIds = input.mapSpotIds ? [...new Set(input.mapSpotIds)] : undefined
    if (mapSpotIds && await tx.mapSpot.count({ where: { id: { in: mapSpotIds } } }) !== mapSpotIds.length) throw new DossierError('Kartenpunkt nicht gefunden', 404)
```

Die Destrukturierung erweitern:

```ts
    const { personIds: _persons, investigationIds: _investigations, vehicleIds: _vehicles, clipIds: _clips, mapSpotIds: _mapSpots, ...fields } = input
    void _persons; void _investigations; void _vehicles; void _clips; void _mapSpots
```

In `relations` ergänzen – `set` genügt, weil Kartenpunkte anders als Einsatzakten nicht sichtbarkeitsbeschränkt sind und ein Update deshalb nichts Verborgenes trennen kann:

```ts
      ...(mapSpotIds ? { mapSpots: { set: mapSpotIds.map(id => ({ id })) } } : {}),
```

Im `create`-Zweig ergänzen:

```ts
          mapSpots: { connect: (mapSpotIds ?? []).map(id => ({ id })) },
```

- [ ] **Step 5: Test laufen lassen und Erfolg prüfen**

Run: `npx tsx --test tests/investigation-media.test.ts`
Expected: PASS, alle Tests.

- [ ] **Step 6: Kartenpunkte in den API-Antworten mitliefern**

In `src/app/api/investigations/dossiers/route.ts` und `src/app/api/investigations/dossiers/[id]/route.ts` jeden `include`, der bereits `vehicles` enthält, um folgende Zeile ergänzen:

```ts
      mapSpots: { select: { id: true, title: true, category: true, icon: true, x: true, y: true }, orderBy: { title: 'asc' } },
```

Falls dort ein `_count`-Block existiert, `mapSpots: true` mit aufnehmen.

Run: `grep -n "vehicles" src/app/api/investigations/dossiers/route.ts src/app/api/investigations/dossiers/\[id\]/route.ts` – jede Fundstelle in einem `include`/`select` prüfen.

- [ ] **Step 7: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dossiers-server.ts src/app/api/investigations/dossiers tests/investigation-media.test.ts
git commit -m "feat: Dauerakten verknüpfen Kartenpunkte"
```

---

### Task 6: Einsatzakten nehmen Kartenpunkte und Bilder auf

**Files:**
- Modify: `src/lib/investigations.ts` (`investigationDetailInclude`)
- Modify: `src/lib/investigations-server.ts` (neue Validierungshelfer)
- Modify: `src/app/api/investigations/route.ts` (POST)
- Modify: `src/app/api/investigations/[id]/route.ts` (PATCH)
- Modify: `tests/investigation-media.test.ts`

**Interfaces:**
- Consumes: Prisma-Felder `Investigation.mapSpots` und `Investigation.photos` aus Task 1.
- Produces:
  - `validateIdList(value: unknown, max?: number): string[]` in `src/lib/investigations-server.ts` – wirft `Error` mit deutscher Meldung bei Nicht-Array, zu vielen oder leeren Einträgen; liefert eine Liste ohne Duplikate.
  - `POST` und `PATCH /api/investigations[/:id]` akzeptieren `mapSpotIds` und `photoIds`.
  - `investigationDetailInclude` enthält `mapSpots` und `photos`.

- [ ] **Step 1: Failing test schreiben**

In `tests/investigation-media.test.ts` am Dateiende ergänzen und den Import oben um `validateIdList` erweitern (`import { validateIdList } from '../src/lib/investigations-server'`):

```ts
test('ID-Listen für Kartenpunkte und Bilder werden entdoppelt und begrenzt', () => {
  assert.deepEqual(validateIdList(['a', 'b', 'a']), ['a', 'b'])
  assert.deepEqual(validateIdList(undefined), [])
  assert.deepEqual(validateIdList([]), [])
  assert.throws(() => validateIdList('a'), /Liste/)
  assert.throws(() => validateIdList([1]), /Liste/)
  assert.throws(() => validateIdList(['']), /Liste/)
  assert.throws(() => validateIdList(Array(201).fill('x')), /zu viele/i)
})
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag prüfen**

Run: `npx tsx --test tests/investigation-media.test.ts`
Expected: FAIL – `validateIdList` ist kein Export.

- [ ] **Step 3: Helfer schreiben**

In `src/lib/investigations-server.ts` ergänzen:

```ts
/**
 * Prüft eine Liste von Fremdschlüsseln aus dem Request-Body. Duplikate
 * fliegen raus, damit ein doppelt geschickter Eintrag nicht als
 * Verknüpfungsfehler beim Datenbankschreiben endet.
 */
export function validateIdList(value: unknown, max = 200): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Ungültige Liste')
  if (value.length > max) throw new Error(`Zu viele Einträge (max. ${max})`)
  const ids = value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
  if (ids.some((entry) => !entry || entry.length > 191)) throw new Error('Ungültige Liste')
  return [...new Set(ids)]
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg prüfen**

Run: `npx tsx --test tests/investigation-media.test.ts`
Expected: PASS.

- [ ] **Step 5: Detail-Include erweitern**

In `src/lib/investigations.ts` in `investigationDetailInclude` nach dem `vehicles`-Block ergänzen:

```ts
  mapSpots: {
    orderBy: [{ title: 'asc' }],
    select: { id: true, title: true, category: true, icon: true, x: true, y: true },
  },
  photos: {
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, title: true, createdAt: true, uploadedById: true },
  },
```

- [ ] **Step 6: POST erweitern**

In `src/app/api/investigations/route.ts` den Import um `validateIdList` ergänzen. Vor `const caseNumber = await nextInvestigationCaseNumber()` einfügen:

```ts
    const mapSpotIds = validateIdList(body.mapSpotIds)
    if (mapSpotIds.length && (await prisma.mapSpot.count({ where: { id: { in: mapSpotIds } } })) !== mapSpotIds.length) {
      return error('Kartenpunkt wurde nicht gefunden', 404)
    }
    const photoIds = validateIdList(body.photoIds)
    if (photoIds.length && (await prisma.investigationPhoto.count({ where: { id: { in: photoIds } } })) !== photoIds.length) {
      return error('Bild wurde nicht gefunden', 404)
    }
```

Im `data`-Objekt von `prisma.investigation.create` neben `assignees` ergänzen:

```ts
        mapSpots: { connect: mapSpotIds.map((id) => ({ id })) },
        photos: { connect: photoIds.map((id) => ({ id })) },
```

- [ ] **Step 7: PATCH erweitern**

In `src/app/api/investigations/[id]/route.ts` den Import um `validateIdList` ergänzen und nach dem `assigneeIds`-Block einfügen:

```ts
    if (body.mapSpotIds !== undefined) {
      const mapSpotIds = validateIdList(body.mapSpotIds)
      if (mapSpotIds.length && (await prisma.mapSpot.count({ where: { id: { in: mapSpotIds } } })) !== mapSpotIds.length) {
        return notFound('Kartenpunkt')
      }
      // `set` genügt: Kartenpunkte sind nicht sichtbarkeitsbeschränkt, ein
      // Update kann also nichts trennen, was der Bearbeiter nicht sieht.
      data.mapSpots = { set: mapSpotIds.map((id) => ({ id })) }
    }

    if (body.photoIds !== undefined) {
      const photoIds = validateIdList(body.photoIds)
      if (photoIds.length && (await prisma.investigationPhoto.count({ where: { id: { in: photoIds } } })) !== photoIds.length) {
        return notFound('Bild')
      }
      data.photos = { set: photoIds.map((id) => ({ id })) }
    }
```

`validateIdList` wirft bei ungültigen Eingaben ein `Error` – das fängt der bestehende `catch`-Block über `routeError(cause)` ab.

- [ ] **Step 8: Typprüfung und Tests**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

Run: `npx tsx --test tests/investigation-media.test.ts tests/map-spot-links.test.ts tests/photo-upload.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/investigations.ts src/lib/investigations-server.ts src/app/api/investigations/route.ts "src/app/api/investigations/[id]/route.ts" tests/investigation-media.test.ts
git commit -m "feat: Einsatzakten verknüpfen Kartenpunkte und Bilder"
```

---

### Task 7: Generischer Wizard-Rahmen

**Files:**
- Create: `src/components/ui/wizard.tsx`

**Interfaces:**
- Consumes: `Button` aus `@/components/ui/button`, `cn` aus `@/lib/utils`.
- Produces:

```ts
export type WizardStep = {
  id: string
  label: string
  /** Optionale Schritte lassen sich überspringen. */
  optional?: boolean
  /** Fehlt der Rückgabewert oder ist er leer, gilt der Schritt als gültig. */
  invalid?: string
  content: React.ReactNode
}

export function Wizard(props: {
  steps: WizardStep[]
  /** `free` lässt jeden Schritt direkt anspringen und jederzeit speichern. */
  mode: 'linear' | 'free'
  submitLabel: string
  saving?: boolean
  failure?: string
  onCancel: () => void
  onSubmit: () => void
}): React.ReactElement
```

- [ ] **Step 1: Komponente schreiben**

`src/components/ui/wizard.tsx` neu anlegen:

```tsx
'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WizardStep = {
  id: string
  label: string
  optional?: boolean
  /** Meldung, warum der Schritt noch nicht abgeschlossen werden kann. */
  invalid?: string
  content: React.ReactNode
}

/**
 * Trägt beide Anlegen-Flows. Beim Anlegen (`linear`) führt der Wizard
 * Schritt für Schritt; beim Bearbeiten (`free`) ist jeder Schritt direkt
 * erreichbar und Speichern jederzeit möglich – für eine Tippfehlerkorrektur
 * soll niemand durch fünf Schritte klicken müssen.
 */
export function Wizard({
  steps,
  mode,
  submitLabel,
  saving = false,
  failure,
  onCancel,
  onSubmit,
}: {
  steps: WizardStep[]
  mode: 'linear' | 'free'
  submitLabel: string
  saving?: boolean
  failure?: string
  onCancel: () => void
  onSubmit: () => void
}) {
  const [index, setIndex] = useState(0)
  const current = steps[index]
  const last = index === steps.length - 1
  const blocked = current.invalid
  const firstBlocking = steps.find((step) => step.invalid)

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-1.5" aria-label="Schritte">
        {steps.map((step, position) => {
          const done = position < index
          const reachable = mode === 'free' || position <= index
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable || saving}
                onClick={() => setIndex(position)}
                aria-current={position === index ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                  position === index
                    ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-white'
                    : done
                      ? 'border-[#343434] text-[#a6a6a6]'
                      : 'border-[#282828] text-[#6a6a6a]',
                  reachable && !saving ? 'hover:border-[#4a4a4a]' : 'cursor-default',
                )}
              >
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#232323] font-mono text-[10px]">
                  {done ? <Check className="h-2.5 w-2.5" /> : position + 1}
                </span>
                {step.label}
                {step.optional && <span className="text-[10.5px] text-[#6a6a6a]">optional</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div>{current.content}</div>

      {blocked && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{blocked}</p>}
      {failure && <p role="alert" className="text-[12.5px] text-red-300">{failure}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#232323] pt-4">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          Abbrechen
        </Button>

        <div className="flex flex-wrap gap-2">
          {index > 0 && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => setIndex(index - 1)}>
              Zurück
            </Button>
          )}
          {!last && (
            <Button
              type="button"
              variant={current.optional ? 'outline' : 'default'}
              disabled={saving || Boolean(blocked)}
              onClick={() => setIndex(index + 1)}
            >
              {current.optional ? 'Überspringen' : 'Weiter'}
            </Button>
          )}
          {(last || mode === 'free') && (
            <Button
              type="button"
              loading={saving}
              disabled={Boolean(firstBlocking)}
              onClick={onSubmit}
              title={firstBlocking ? firstBlocking.invalid : undefined}
            >
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Button-Varianten prüfen**

Run: `grep -n "variant" src/components/ui/button.tsx | head -20`
Expected: Die im Wizard verwendeten Varianten `default`, `outline` und `ghost` existieren. Falls die Standardvariante anders heißt, im Wizard entsprechend anpassen.

- [ ] **Step 3: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/wizard.tsx
git commit -m "feat: generischer Mehrschritt-Wizard für Aktenformulare"
```

---

### Task 8: Kartenpunkt-Auswahl auf Basis der bestehenden Karte

**Files:**
- Modify: `src/components/map/city-map.tsx`
- Create: `src/components/map/spot-picker.tsx`

**Interfaces:**
- Consumes: `CityMap`, `MAP_CATEGORIES`/`mapCategory` aus `@/lib/map-spots`, `POST /api/map/spots`.
- Produces:
  - `CityMap` bekommt zwei optionale Props: `selectedIds?: string[]` und `selectable?: boolean`. Bei `selectable` ruft ein Klick auf eine Nadel `onOpenDetail(spot)` als Auswahl-Umschalter auf; ausgewählte Nadeln bekommen einen Ring.
  - `export type PickedSpot = { id: string; title: string; category: string }` – bewusst schlank, damit auch Ansichten, die nur eine verkürzte Auswahl geladen haben (die Einsatzakten-Detailansicht in Task 11), den Picker ohne Typzusicherung füttern können. Ein volles `MapSpot` ist einem `PickedSpot` zuweisbar.
  - `SpotPickerField({ value, onChange, canCreate }: { value: PickedSpot[]; onChange: (spots: PickedSpot[]) => void; canCreate: boolean })`

- [ ] **Step 1: `CityMap` um Auswahlmarkierung erweitern**

In `src/components/map/city-map.tsx` das Interface `CityMapProps` ergänzen:

```ts
  /** Im Auswahlmodus markierte Punkte. */
  selectedIds?: string[]
  /** Klick auf eine Nadel wählt aus, statt die Detailansicht zu öffnen. */
  selectable?: boolean
```

Die Destrukturierung der Props um `selectedIds = []` und `selectable = false` erweitern.

Run: `grep -n "MapNeedle" src/components/map/city-map.tsx`
An der Stelle, an der `MapNeedle` gerendert wird, dem umgebenden Element eine Auswahlklasse geben:

```tsx
className={cn(existingClasses, selectable && selectedIds.includes(spot.id) && 'ring-4 ring-[#a78bfa] ring-offset-0 rounded-full')}
```

`import { cn } from '@/lib/utils'` ergänzen, falls nicht vorhanden. `onOpenDetail` bleibt der Klick-Handler – im Auswahlmodus interpretiert der Aufrufer ihn als Umschalten.

- [ ] **Step 2: `SpotPickerField` schreiben**

`src/components/map/spot-picker.tsx` neu anlegen:

```tsx
'use client'

import { useState } from 'react'
import { MapPin, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { mapCategory, type MapSpot } from '@/lib/map-spots'
import { CityMap } from '@/components/map/city-map'
import { SpotEditorDialog, type SpotFormValues } from '@/components/map/spot-editor-dialog'

/** Was eine Akte von einem Kartenpunkt braucht. Absichtlich weniger als ein
 *  volles `MapSpot`, damit auch Ansichten mit verkürzter Auswahl den Picker
 *  ohne Typzusicherung befüllen können. */
export type PickedSpot = { id: string; title: string; category: string }

/**
 * Auswahl von Kartenpunkten für eine Akte. Nutzt bewusst dieselbe `CityMap`
 * wie die Kartenseite – ein zweiter, kleinerer Kartenrenderer würde nur
 * auseinanderlaufen.
 */
export function SpotPickerField({ value, onChange, canCreate }: { value: PickedSpot[]; onChange: (spots: PickedSpot[]) => void; canCreate: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null)
  const [placing, setPlacing] = useState(false)
  const [failure, setFailure] = useState('')
  const { data, refetch } = useFetch<MapSpot[]>(open ? '/api/map/spots' : null)
  const { execute, loading: saving } = useApi<MapSpot>()

  const spots = data ?? []
  const selectedIds = value.map((spot) => spot.id)
  const toggle = (spot: MapSpot) =>
    onChange(selectedIds.includes(spot.id) ? value.filter((entry) => entry.id !== spot.id) : [...value, spot])

  const visible = spots.filter((spot) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return spot.title.toLowerCase().includes(needle) || mapCategory(spot.category).label.toLowerCase().includes(needle)
  })

  const createSpot = async (values: SpotFormValues) => {
    setFailure('')
    const created = await execute('/api/map/spots', {
      method: 'POST',
      body: JSON.stringify({ ...values, icon: values.icon.trim() || null, ...pendingPosition }),
    })
    setPendingPosition(null)
    setPlacing(false)
    await refetch()
    if (created) onChange([...value, created])
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 py-5 text-sm text-[#808080]">
          <MapPin size={18} />
          Noch keine Kartenpunkte verknüpft.
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((spot) => {
            const category = mapCategory(spot.category)
            return (
              <li key={spot.id}>
                <button
                  type="button"
                  onClick={() => toggle(spot)}
                  aria-label={`${spot.title} entfernen`}
                  className="flex items-center gap-1.5 rounded-full border border-[#343434] px-3 py-1.5 text-[12px] text-[#d4d4d4] hover:border-[#fca5a5]"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: category.hex }} />
                  {spot.title}
                  <span className="text-[#6a6a6a]">×</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MapPin size={14} />
        Kartenpunkte wählen
      </Button>

      <Modal open={open} onClose={() => { setOpen(false); setPlacing(false); setPendingPosition(null) }} title="Kartenpunkte verknüpfen" size="xl">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="h-[52dvh] min-h-[320px]">
            <CityMap
              spots={visible}
              canManage={placing}
              selectable
              selectedIds={selectedIds}
              onPlace={(position) => { if (placing) setPendingPosition(position) }}
              onOpenDetail={toggle}
              movingSpot={null}
              moving={false}
              onMoveTo={() => {}}
              onCancelMove={() => {}}
              pendingPosition={pendingPosition}
            />
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <Input aria-label="Kartenpunkt suchen" placeholder="Punkt oder Kategorie suchen …" value={search} onChange={(event) => setSearch(event.target.value)} />
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {visible.map((spot) => {
                const category = mapCategory(spot.category)
                return (
                  <li key={spot.id}>
                    <button
                      type="button"
                      onClick={() => toggle(spot)}
                      aria-pressed={selectedIds.includes(spot.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] ${selectedIds.includes(spot.id) ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-white' : 'border-[#282828] text-[#c4c4c4] hover:border-[#404040]'}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: category.hex }} />
                      <span className="min-w-0 truncate">{spot.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-[#6a6a6a]">{category.label}</span>
                    </button>
                  </li>
                )
              })}
              {visible.length === 0 && <li className="px-1 py-3 text-[12px] text-[#808080]">Keine passenden Punkte.</li>}
            </ul>

            {canCreate && (
              <Button type="button" size="sm" variant={placing ? 'default' : 'outline'} onClick={() => { setPlacing(!placing); setPendingPosition(null) }}>
                <Plus size={14} />
                {placing ? 'Platzierung abbrechen' : 'Neuen Punkt setzen'}
              </Button>
            )}
            {placing && !pendingPosition && <p className="text-[11.5px] text-[#a6a6a6]">Klicke auf die Karte, um die Position zu wählen.</p>}
            {failure && <p role="alert" className="text-[12px] text-red-300">{failure}</p>}
            <Button type="button" size="sm" onClick={() => setOpen(false)}>Fertig ({value.length})</Button>
          </div>
        </div>
      </Modal>

      <SpotEditorDialog
        open={Boolean(pendingPosition)}
        spot={null}
        position={pendingPosition}
        saving={saving}
        onClose={() => setPendingPosition(null)}
        onSubmit={createSpot}
      />
    </div>
  )
}
```

`MapSpot` wird für die Liste aus `/api/map/spots` gebraucht, `PickedSpot` für das, was nach außen geht – ein `MapSpot` erfüllt `PickedSpot`, deshalb funktioniert `toggle` mit beiden.

- [ ] **Step 3: Signatur von `SpotEditorDialog` prüfen**

Run: `grep -n "export function SpotEditorDialog" -A 20 src/components/map/spot-editor-dialog.tsx`
Expected: Die Props `open`, `spot`, `position`, `saving`, `onClose`, `onSubmit` stimmen mit dem obigen Aufruf überein. Falls `onSubmit` Fehler selbst anzeigt (so verhält sich `map-workspace.tsx`), bleibt `setFailure` im Picker ungenutzt – dann `failure`/`setFailure` entfernen.

- [ ] **Step 4: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

- [ ] **Step 5: Commit**

```bash
git add src/components/map/city-map.tsx src/components/map/spot-picker.tsx
git commit -m "feat: Kartenpunkt-Auswahl für Akten auf Basis der Stadtkarte"
```

---

### Task 9: Einsatzakte als Wizard anlegen, Verschluss vorangekreuzt

**Files:**
- Modify: `src/components/investigations/investigations-workspace.tsx:48-135` und `:235-298`

**Interfaces:**
- Consumes: `Wizard`/`WizardStep` (Task 7), `SpotPickerField` (Task 8), `PhotoPicker` (Task 3), `mapSpotIds`/`photoIds` in der API (Task 6).
- Produces: nichts für spätere Aufgaben.

- [ ] **Step 1: Formularzustand erweitern und Verschluss vorankreuzen**

In `src/components/investigations/investigations-workspace.tsx` `CreateForm` und `emptyForm()` ersetzen:

```tsx
type CreateForm = {
  title: string
  summary: string
  status: string
  priority: string
  classified: boolean
  leadAgentId: string
  assigneeIds: string[]
  mapSpots: PickedSpot[]
  photos: CatalogPhoto[]
}

/** Neue Akten sind standardmäßig Verschlusssache: die Öffnung für alle
 *  Ermittler soll eine bewusste Entscheidung sein, nicht der Normalfall. */
function emptyForm(): CreateForm {
  return {
    title: '',
    summary: '',
    status: 'OPEN',
    priority: 'NORMAL',
    classified: true,
    leadAgentId: '',
    assigneeIds: [],
    mapSpots: [],
    photos: [],
  }
}
```

Imports ergänzen:

```tsx
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { PhotoPicker, type CatalogPhoto } from '@/components/investigations/photo-catalog'
```

- [ ] **Step 2: Neue Felder mitschicken**

In `handleCreate` den `body` erweitern:

```tsx
        body: JSON.stringify({
          title: form.title,
          summary: form.summary,
          status: form.status,
          priority: form.priority,
          classified: form.classified,
          leadAgentId: form.leadAgentId || null,
          assigneeIds: form.assigneeIds,
          mapSpotIds: form.mapSpots.map((spot) => spot.id),
          photoIds: form.photos.map((photo) => photo.id),
        }),
```

- [ ] **Step 3: `map:manage` für den Anlegen-Button im Picker abfragen**

Neben `canManage` ergänzen:

```tsx
  const canPlaceSpots = hasPermission(user, 'map:manage')
```

- [ ] **Step 4: Schritte definieren**

Oberhalb des `return` in `InvestigationsWorkspace` einfügen:

```tsx
  const steps: WizardStep[] = [
    {
      id: 'anlass',
      label: 'Anlass',
      invalid: form.title.trim() ? undefined : 'Bitte einen Titel für die Akte angeben.',
      content: (
        <div className="space-y-4">
          <Input
            label="Titel"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="z. B. Waffenhandel Sandy Shores"
          />
          <Textarea
            label="Zusammenfassung"
            value={form.summary}
            onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
            placeholder="Ermittlungslage, Anlass, erste Erkenntnisse"
            rows={4}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Status"
              options={labelOptions(INVESTIGATION_STATUS_LABELS)}
              value={form.status}
              onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
            />
            <Select
              label="Priorität"
              options={labelOptions(INVESTIGATION_PRIORITY_LABELS)}
              value={form.priority}
              onValueChange={(value) => setForm((prev) => ({ ...prev, priority: value }))}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'zustaendigkeit',
      label: 'Zuständigkeit',
      content: (
        <div className="space-y-4">
          <Select
            label="Fallführung"
            options={agentOptions}
            value={form.leadAgentId}
            onValueChange={(value) => setForm((prev) => ({ ...prev, leadAgentId: value }))}
          />
          <AgentPicker
            agents={agents ?? []}
            value={form.assigneeIds}
            onChange={(assigneeIds) => setForm((prev) => ({ ...prev, assigneeIds }))}
            description="Zugewiesene Ermittler sehen die Akte auch dann, wenn sie als Verschlusssache geführt wird."
          />
          <div className="rounded-[10px] border border-[#2a2a2a] bg-[#141414] p-3.5">
            <Checkbox
              checked={form.classified}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, classified: checked }))}
              label="Als Verschlusssache führen"
            />
            <p className="mt-2 text-[12px] leading-relaxed text-[#a6a6a6]">
              {form.classified
                ? 'Voreingestellt. Nur Ersteller, Fallführung, zugewiesene Ermittler und Berechtigte sehen die Akte samt Clips.'
                : 'Abgewählt: die Akte ist für alle Ermittler mit Akteneinsicht sichtbar.'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'karte',
      label: 'Kartenpunkte',
      optional: true,
      content: (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#a6a6a6]">
            Fand der Einsatz an einer bekannten Route, einem Sammler oder einem Anwesen statt? Verknüpfe die Punkte hier.
          </p>
          <SpotPickerField
            value={form.mapSpots}
            onChange={(mapSpots) => setForm((prev) => ({ ...prev, mapSpots }))}
            canCreate={canPlaceSpots}
          />
        </div>
      ),
    },
    {
      id: 'bilder',
      label: 'Bilder',
      optional: true,
      content: (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#a6a6a6]">
            Bilder landen im Bildkatalog und lassen sich danach auch an Personen- und Anwesenakten verwenden.
          </p>
          <PhotoPicker
            value={form.photos}
            onChange={(photos) => setForm((prev) => ({ ...prev, photos }))}
          />
        </div>
      ),
    },
    {
      id: 'pruefen',
      label: 'Prüfen',
      content: (
        <dl className="grid gap-2.5 text-[12.5px]">
          {[
            ['Titel', form.title || '—'],
            ['Status', INVESTIGATION_STATUS_LABELS[form.status as keyof typeof INVESTIGATION_STATUS_LABELS] ?? form.status],
            ['Priorität', INVESTIGATION_PRIORITY_LABELS[form.priority as keyof typeof INVESTIGATION_PRIORITY_LABELS] ?? form.priority],
            ['Fallführung', agentOptions.find((option) => option.value === form.leadAgentId)?.label ?? 'Keine Fallführung'],
            ['Ermittler', form.assigneeIds.length ? `${form.assigneeIds.length} zugewiesen` : 'Keine'],
            ['Verschlusssache', form.classified ? 'Ja' : 'Nein'],
            ['Kartenpunkte', form.mapSpots.length ? form.mapSpots.map((spot) => spot.title).join(', ') : 'Keine'],
            ['Bilder', form.photos.length ? `${form.photos.length} ausgewählt` : 'Keine'],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1e1e1e] pb-2">
              <dt className="w-36 shrink-0 text-[#808080]">{label}</dt>
              <dd className="min-w-0 text-[#d4d4d4]">{value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ]
```

- [ ] **Step 5: Modal-Inhalt durch den Wizard ersetzen**

Den kompletten Inhalt des `<Modal open={createOpen} …>` (der `<div className="space-y-4">`-Block) ersetzen durch:

```tsx
        <Wizard
          steps={steps}
          mode="linear"
          submitLabel="Akte anlegen"
          saving={saving}
          onCancel={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
```

Am `Modal` `size="xl"` setzen und die Beschreibung anpassen:

```tsx
        description="In fünf Schritten. Das Aktenzeichen wird automatisch vergeben."
```

- [ ] **Step 6: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe. Erscheint „`Checkbox` is declared but its value is never read" nicht – die Checkbox wird in Schritt 2 weiterhin verwendet.

- [ ] **Step 7: Manuell prüfen**

Run: `npm run dev`, `/investigations` öffnen, „Neue Akte".
Expected:
- Ohne Titel ist „Weiter" gesperrt und die Meldung „Bitte einen Titel für die Akte angeben." steht darunter.
- Schritt 2 zeigt den Verschluss-Haken **gesetzt**.
- Schritte 3 und 4 zeigen „Überspringen" statt „Weiter".
- Schritt 5 listet alle Eingaben; „Akte anlegen" erzeugt die Akte, und die Detailseite zeigt sie mit Verschluss-Badge.

- [ ] **Step 8: Commit**

```bash
git add src/components/investigations/investigations-workspace.tsx
git commit -m "feat: Einsatzakte über Wizard anlegen, Verschluss vorangekreuzt"
```

---

### Task 10: Dauerakte als Wizard anlegen und bearbeiten

**Files:**
- Modify: `src/components/investigations/dossiers-workspace.tsx:224-261` (`DossierEditor`), `:30-44` (Typ `Dossier`)

**Interfaces:**
- Consumes: `Wizard`/`WizardStep` (Task 7), `SpotPickerField` (Task 8), `mapSpotIds` in der Dossier-API (Task 5).
- Produces: nichts für spätere Aufgaben.

- [ ] **Step 1: Typ `Dossier` um Kartenpunkte erweitern**

In `src/components/investigations/dossiers-workspace.tsx` im Typ `Dossier` ergänzen:

```ts
  mapSpots?: PickedSpot[];
```

und im `_count`-Teil `mapSpots: number` aufnehmen. Import ergänzen:

```ts
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { Wizard, type WizardStep } from '@/components/ui/wizard'
```

- [ ] **Step 2: `DossierEditor` auf den Wizard umstellen**

`DossierEditor` (Zeile ~224–261) vollständig ersetzen:

```tsx
function DossierEditor({ existing, parent, onClose, onSaved }: { existing?: Dossier; parent?: { id: string; title: string }; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [kind, setKind] = useState<DossierKind>(existing?.kind ?? (parent ? 'FILE' : 'COLLECTION'))
  const [description, setDescription] = useState(existing?.description ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [photoId, setPhotoId] = useState(existing?.photoId ?? null)
  const [selectedParent, setSelectedParent] = useState<{ id: string; title: string } | null>(existing?.parent ?? parent ?? null)
  const [parentSearch, setParentSearch] = useState('')
  const [chooseParent, setChooseParent] = useState(false)
  const [personIds, setPersonIds] = useState(existing?.persons?.map(p => p.id) ?? [])
  const [investigationIds, setInvestigationIds] = useState(existing?.investigations?.map(i => i.id) ?? [])
  const [vehicleIds, setVehicleIds] = useState(existing?.vehicles?.map(v => v.id) ?? [])
  const [clipIds, setClipIds] = useState(existing?.clips?.map(c => c.id) ?? [])
  const [mapSpots, setMapSpots] = useState<PickedSpot[]>(existing?.mapSpots ?? [])
  const [failure, setFailure] = useState('')
  const persons = useRegisterOptions('persons')
  const cases = useRegisterOptions('investigations')
  const vehicles = useRegisterOptions('vehicles')
  const clips = useRegisterOptions('clips')
  const optionsLoading = persons.loading || cases.loading || vehicles.loading || clips.loading
  const optionsError = persons.error || cases.error || vehicles.error || clips.error
  const parents = useFetch<List>(chooseParent ? `/api/investigations/dossiers?search=${encodeURIComponent(parentSearch)}` : null)
  const { execute, loading } = useApi()

  const save = async () => {
    setFailure('')
    try {
      await execute(`/api/investigations/dossiers${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title, kind,
          description: description || null,
          address: address || null,
          photoId,
          parentId: selectedParent?.id ?? null,
          personIds, investigationIds, vehicleIds, clipIds,
          mapSpotIds: mapSpots.map(spot => spot.id),
        }),
      })
      onSaved()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen')
    }
  }

  const steps: WizardStep[] = [
    {
      id: 'art',
      label: 'Art & Titel',
      invalid: title.trim() ? undefined : 'Bitte einen Titel für die Akte angeben.',
      content: <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(DOSSIER_KINDS).map(([value, label]) => <button type="button" key={value} onClick={() => setKind(value as DossierKind)} aria-pressed={kind === value}
            className={`rounded-[10px] border p-3 text-left ${kind === value ? 'border-[#a78bfa] bg-[#a78bfa]/10' : 'border-[#282828] hover:border-[#404040]'}`}>
            <span className="block text-[13px] font-medium text-white">{label}</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[#808080]">{DOSSIER_KIND_HINTS[value as DossierKind]}</span>
          </button>)}
        </div>
        <Input label="Titel" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} placeholder="z. B. Familie Moretti" />
        <div className="space-y-2">
          <p className="text-sm text-[#a6a6a6]">Übergeordnete Akte: {selectedParent?.title ?? 'Keine · Hauptakte'}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setChooseParent(!chooseParent)}>Übergeordnete Akte wählen</Button>
            {selectedParent && <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedParent(null)}>Als Hauptakte führen</Button>}
          </div>
          {chooseParent && <>
            <Input placeholder="Akte suchen …" value={parentSearch} onChange={e => setParentSearch(e.target.value)} />
            {parents.error && <p role="alert" className="text-xs text-red-300">{parents.error}</p>}
            <div className="max-h-32 overflow-y-auto">{parents.data?.items.filter(item => item.id !== existing?.id).map(item => <button type="button" className="block w-full p-2 text-left text-sm text-[#c4b5fd] hover:bg-[#232323]" key={item.id} onClick={() => { setSelectedParent(item); setChooseParent(false) }}>{item.title}</button>)}</div>
          </>}
        </div>
      </div>,
    },
    {
      id: 'beschreibung',
      label: 'Beschreibung',
      optional: true,
      content: <div className="space-y-4">
        <Input label="Adresse / Standort" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="z. B. Anwesen am Lake Vinewood" />
        <PhotoField value={photoId ? photoUrl(photoId) : null} onChange={photo => setPhotoId(photo?.id ?? null)} />
        <Textarea label="Informationen und Notizen" value={description} onChange={e => setDescription(e.target.value)} maxLength={30000} rows={6} placeholder="Hintergründe, Bewohner, Eigentümer, Beobachtungen …" />
      </div>,
    },
    {
      id: 'karte',
      label: 'Kartenpunkte',
      optional: true,
      content: <div className="space-y-3">
        <p className="text-[12.5px] text-[#a6a6a6]">Routen, Sammler und Anwesen, die zu dieser Akte gehören.</p>
        <SpotPickerField value={mapSpots} onChange={setMapSpots} canCreate={hasPermission(user, 'map:manage')} />
      </div>,
    },
    {
      id: 'verknuepfungen',
      label: 'Verknüpfungen',
      optional: true,
      content: <div className="space-y-4">
        {optionsError && <p role="alert" className="text-sm text-red-300">{optionsError}</p>}
        <RelationPicker label="Personen / Familienmitglieder" options={persons.options} value={personIds} onChange={setPersonIds} />
        <RelationPicker label="Einsatzakten" options={cases.options} value={investigationIds} onChange={setInvestigationIds} />
        <RelationPicker label="Fahrzeugakten" options={vehicles.options} value={vehicleIds} onChange={setVehicleIds} />
        <RelationPicker label="Bodycams" options={clips.options} value={clipIds} onChange={setClipIds} />
      </div>,
    },
    {
      id: 'pruefen',
      label: 'Prüfen',
      content: <dl className="grid gap-2.5 text-[12.5px]">
        {([
          ['Kategorie', DOSSIER_KINDS[kind]],
          ['Titel', title || '—'],
          ['Übergeordnet', selectedParent?.title ?? 'Hauptakte'],
          ['Adresse', address || '—'],
          ['Kartenpunkte', mapSpots.length ? mapSpots.map(spot => spot.title).join(', ') : 'Keine'],
          ['Personen', String(personIds.length)],
          ['Einsatzakten', String(investigationIds.length)],
          ['Fahrzeuge', String(vehicleIds.length)],
          ['Bodycams', String(clipIds.length)],
        ] as [string, string][]).map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1e1e1e] pb-2">
          <dt className="w-36 shrink-0 text-[#808080]">{label}</dt>
          <dd className="min-w-0 text-[#d4d4d4]">{value}</dd>
        </div>)}
      </dl>,
    },
  ]

  return <Modal open onClose={loading ? () => {} : onClose} title={existing ? 'Dauerakte bearbeiten' : 'Dauerakte anlegen'} size="xl">
    <Wizard
      steps={steps}
      // Beim Bearbeiten darf jeder Schritt direkt angesprungen werden.
      mode={existing ? 'free' : 'linear'}
      submitLabel="Speichern"
      saving={loading || optionsLoading}
      failure={failure}
      onCancel={onClose}
      onSubmit={save}
    />
  </Modal>
}
```

- [ ] **Step 3: Erklärtexte für die Kategorien ergänzen**

Oberhalb von `DossierEditor` einfügen:

```tsx
/** Kurzerklärungen für die Kategorieauswahl im Wizard. Die reinen Labels
 *  aus `DOSSIER_KINDS` sagen nicht, wofür man welche Art nimmt. */
const DOSSIER_KIND_HINTS: Record<DossierKind, string> = {
  FAMILY: 'Eine Familie oder Organisation mit ihren Mitgliedern, Routen und Sammlern.',
  COLLECTION: 'Eine offene Sammlung, die mehrere Akten unter einem Thema bündelt.',
  PROPERTY: 'Ein Anwesen oder Objekt mit Adresse, Bewohnern und Beobachtungen.',
  FILE: 'Eine Unterakte innerhalb einer übergeordneten Akte.',
}
```

- [ ] **Step 4: Typprüfung**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe. Falls `useAuth` oder `hasPermission` in der Datei noch nicht importiert sind: sie sind es bereits (Zeilen 10–11).

- [ ] **Step 5: Manuell prüfen**

Run: `npm run dev`, `/investigations/dossiers` öffnen, „Neue Akte".
Expected:
- Schritt 1 zeigt vier Kategoriekarten mit Erklärtext; ohne Titel bleibt „Weiter" gesperrt.
- Schritt 3 öffnet die Karte und verknüpft Punkte.
- Nach dem Speichern zeigt die Detailansicht die Akte.
Danach eine bestehende Akte bearbeiten.
Expected: Alle Schritte sind direkt anklickbar und „Speichern" ist von Anfang an aktiv.

- [ ] **Step 6: Commit**

```bash
git add src/components/investigations/dossiers-workspace.tsx
git commit -m "feat: Dauerakte über Wizard anlegen und bearbeiten"
```

---

### Task 11: Rückrichtung – Verknüpfungen sichtbar machen

**Files:**
- Modify: `src/components/map/spot-detail-dialog.tsx`
- Modify: `src/components/investigations/investigation-detail.tsx`
- Modify: `src/components/investigations/dossiers-workspace.tsx` (Registeransicht)
- Modify: `src/components/investigations/types.ts`

**Interfaces:**
- Consumes: `MapSpot.dossiers`/`MapSpot.investigations` (Task 4), `investigationDetailInclude` mit `mapSpots`/`photos` (Task 6), `SpotPickerField` (Task 8), `PhotoPicker` (Task 3), `Dossier.mapSpots` (Task 5).
- Produces: nichts für spätere Aufgaben.

- [ ] **Step 1: Detailtyp der Einsatzakte erweitern**

In `src/components/investigations/types.ts` den Typ der Einsatzakten-Detailansicht (der mit `entries`, `persons`, `clips`, `evidence`) um zwei Felder ergänzen:

```ts
  mapSpots: { id: string; title: string; category: string; icon: string | null; x: number; y: number }[]
  photos: { id: string; title: string; createdAt: string; uploadedById: string | null }[]
```

Run: `grep -n "evidence" src/components/investigations/types.ts` – dort steht der richtige Typ.

- [ ] **Step 2: Verknüpfte Akten im Kartenpunkt-Dialog zeigen**

In `src/components/map/spot-detail-dialog.tsx` `import Link from 'next/link'` ergänzen und zwischen der Beschreibung (`<p className="mt-4 flex-1 …">`) und der Erstellerzeile einfügen:

```tsx
            {(spot.dossiers.length > 0 || spot.investigations.length > 0) && (
              <div className="mt-4 space-y-2 border-t border-[#232323] pt-3">
                <p className="text-[11.5px] font-medium text-[#a6a6a6]">Verknüpfte Akten</p>
                <ul className="space-y-1">
                  {spot.dossiers.map((dossier) => (
                    <li key={dossier.id}>
                      <Link
                        href={`/investigations/dossiers?id=${encodeURIComponent(dossier.id)}`}
                        className="text-[12.5px] text-[#c4b5fd] hover:underline"
                      >
                        {dossier.title}
                      </Link>
                    </li>
                  ))}
                  {spot.investigations.map((investigation) => (
                    <li key={investigation.id} className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/investigations/${investigation.id}`}
                        className="text-[12.5px] text-[#c4b5fd] hover:underline"
                      >
                        {investigation.caseNumber} · {investigation.title}
                      </Link>
                      {investigation.classified && (
                        <span className="rounded bg-[#7f1d1d]/40 px-1.5 text-[10.5px] text-[#fca5a5]">Verschluss</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
```

- [ ] **Step 3: Zwei Karten in der Einsatzakten-Detailansicht ergänzen**

In `src/components/investigations/investigation-detail.tsx` vor der Karte „Bodycam-Clips" (`{/* Clips der Akte */}`) einfügen. Die Zustände `spotsOpen`/`photosOpen` oben bei den anderen `useState`-Aufrufen anlegen, dazu `mapSpots`/`photos` als lokale Auswahl:

```tsx
  const [linkOpen, setLinkOpen] = useState<'spots' | 'photos' | null>(null)
```

Karten:

```tsx
      {/* Kartenpunkte */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-white">Kartenpunkte ({investigation.mapSpots.length})</h2>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setLinkOpen('spots')}>
              <MapPin className="h-3.5 w-3.5" />
              Verknüpfen
            </Button>
          )}
        </div>
        {investigation.mapSpots.length === 0 ? (
          <p className="py-3 text-[12.5px] text-[#6a6a6a]">Keine Kartenpunkte zu dieser Akte.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {investigation.mapSpots.map((spot) => (
              <li key={spot.id}>
                <Link
                  href="/map"
                  className="flex items-center gap-1.5 rounded-full border border-[#343434] px-3 py-1.5 text-[12px] text-[#d4d4d4] hover:border-[#a78bfa]"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: mapCategory(spot.category).hex }} />
                  {spot.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Bilder */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-white">Bilder ({investigation.photos.length})</h2>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setLinkOpen('photos')}>
              <ImageIcon className="h-3.5 w-3.5" />
              Verknüpfen
            </Button>
          )}
        </div>
        {investigation.photos.length === 0 ? (
          <p className="py-3 text-[12.5px] text-[#6a6a6a]">Noch keine Bilder zu dieser Akte.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {investigation.photos.map((photo) => (
              <Image
                key={photo.id}
                unoptimized
                src={`/api/investigations/photos/${photo.id}/image`}
                alt={photo.title}
                width={320}
                height={240}
                className="aspect-[4/3] w-full rounded-lg border border-[#2a2a2a] object-cover"
              />
            ))}
          </div>
        )}
      </Card>
```

Imports ergänzen: `Image` aus `next/image`, `MapPin` und `ImageIcon` aus `lucide-react`, `mapCategory` aus `@/lib/map-spots`.

- [ ] **Step 4: Verknüpfungsdialog für beide Karten**

Am Ende der Komponente, neben den vorhandenen Dialogen, einfügen:

```tsx
      <Modal open={linkOpen !== null} onClose={() => setLinkOpen(null)} title={linkOpen === 'photos' ? 'Bilder verknüpfen' : 'Kartenpunkte verknüpfen'} size="xl">
        {linkOpen === 'spots' && (
          <SpotPickerField
            value={investigation.mapSpots}
            canCreate={hasPermission(user, 'map:manage')}
            onChange={async (spots) => {
              await execute(`/api/investigations/${investigationId}`, {
                method: 'PATCH',
                body: JSON.stringify({ mapSpotIds: spots.map((spot) => spot.id) }),
              })
              await refetch()
            }}
          />
        )}
        {linkOpen === 'photos' && (
          <PhotoPicker
            value={investigation.photos.map((photo) => ({ id: photo.id, title: photo.title, url: `/api/investigations/photos/${photo.id}/image` }))}
            onChange={async (photos) => {
              await execute(`/api/investigations/${investigationId}`, {
                method: 'PATCH',
                body: JSON.stringify({ photoIds: photos.map((photo) => photo.id) }),
              })
              await refetch()
            }}
          />
        )}
      </Modal>
```

Der `mapSpots`-Select aus Task 6 liefert `{ id, title, category, icon, x, y }` – das erfüllt `PickedSpot` ohne Zusicherung.

Prüfen, ob `execute`, `refetch`, `user` und `hasPermission` in der Komponente bereits vorhanden sind:
Run: `grep -n "useApi\|refetch\|useAuth\|hasPermission" src/components/investigations/investigation-detail.tsx | head`

- [ ] **Step 5: Kartenpunkte als Register der Dauerakte**

In `src/components/investigations/dossiers-workspace.tsx` in dem `<div className="mt-7 grid gap-5 sm:grid-cols-3">`-Block die Klasse auf `sm:grid-cols-2 lg:grid-cols-4` ändern und eine vierte Sektion ergänzen:

```tsx
        <RegisterSection title="Kartenpunkte" empty="Keine Kartenpunkte verknüpft." manage={manage} onAdd={() => setEditor('edit')}
          entries={current.mapSpots?.map(spot => ({ id: spot.id, href: '/map', label: spot.title, hint: mapCategory(spot.category).label }))} />
```

Import ergänzen: `import { mapCategory } from '@/lib/map-spots'`.

Kartenpunkte laufen bewusst über den Wizard-Schritt statt über einen eigenen `QuickRelationEditor`: der Picker braucht die Karte, und die passt nicht in den schmalen Schnelldialog.

- [ ] **Step 6: Typprüfung und alle Tests**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe.

Run: `npx tsx --test tests/photo-upload.test.ts tests/map-spot-links.test.ts tests/investigation-media.test.ts`
Expected: PASS.

Run: `npm run lint`
Expected: keine Fehler.

- [ ] **Step 7: Manuell prüfen**

Run: `npm run dev`
Expected:
- `/map`: Rechtsklick auf eine verknüpfte Nadel zeigt „Verknüpfte Akten" mit klickbaren Links.
- Eine Verschlusssache erscheint dort nur für Berechtigte. Zum Prüfen mit einem Konto ohne `investigations:classified` anmelden.
- `/investigations/<id>`: Karten „Kartenpunkte" und „Bilder" zeigen die Verknüpfungen und lassen sich nachpflegen.
- `/investigations/dossiers?id=…`: Register „Kartenpunkte" listet die Punkte.

- [ ] **Step 8: Commit**

```bash
git add src/components/map/spot-detail-dialog.tsx src/components/investigations/investigation-detail.tsx src/components/investigations/dossiers-workspace.tsx src/components/investigations/types.ts
git commit -m "feat: verknüpfte Kartenpunkte, Akten und Bilder in allen Detailansichten"
```

---

### Task 12: Abschluss – Build und Dokumentation

**Files:**
- Modify: `docs/investigation-media-setup.md`

- [ ] **Step 1: Vollständigen Build fahren**

Run: `npm run build`
Expected: erfolgreicher Build ohne Typ- oder Lint-Fehler.

- [ ] **Step 2: Dokumentation ergänzen**

In `docs/investigation-media-setup.md` einen Abschnitt anhängen:

```markdown
## Bilder hochladen

Neben dem Discord-Bilderchannel lassen sich Bilder direkt im Dashboard
hochladen – im Bildkatalog, im Bild-Feld einer Akte und im Bilder-Schritt
des Einsatzakten-Wizards. Voraussetzung ist `investigations:manage`.

Hochgeladene Bilder liegen in derselben Tabelle und demselben Verzeichnis
(`uploads/investigation-photos/`) wie die importierten. Sie haben keine
Discord-Herkunft: `sourceKey`, `channelId` und `messageId` bleiben leer,
stattdessen ist `uploadedById` gesetzt.

Grenzen: 20 MB pro Bild, Formate JPG, PNG, WebP und GIF. Der Typ wird an
den Magic Bytes erkannt, ein abweichender `Content-Type` oder eine
umbenannte Datei ändert daran nichts.

## Kartenpunkte an Akten

Dauerakten und Einsatzakten verknüpfen Kartenpunkte (`/map`). Bei
Dauerakten sind das die Routen, Sammler und Anwesen einer Familie; bei
Einsatzakten die Orte, an denen der Einsatz stattfand.

Der Punkt selbst bleibt für alle mit `map:view` sichtbar. Gefiltert werden
nur die Verknüpfungen: eine Verschlusssache erscheint im Kartenpunkt-Dialog
nur für Berechtigte.
```

- [ ] **Step 3: Commit**

```bash
git add docs/investigation-media-setup.md
git commit -m "docs: Bild-Upload und Kartenpunkt-Verknüpfungen dokumentiert"
```

---

## Bekannte Stolpersteine

- **`useApi` erzwingt `application/json`.** Der Bild-Upload muss deshalb ein nacktes `fetch` verwenden (Task 3, Step 1). Wer den Hook benutzt, bekommt einen 400er mit „Unterstützt werden JPG, PNG, WebP und GIF.", weil der JSON-Header den Body nicht ändert, aber der vorgeschaltete Proxy den Stream anders behandeln kann.
- **`photoPath()` validiert den Dateinamen streng** (`/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/`). `randomUUID()` plus die Endung aus `detectPhotoType()` erfüllen das; ein selbst gebauter Name in der Regel nicht.
- **`prisma db push` ohne `npm run db:push`** überspringt das Backup. Immer das npm-Skript nehmen.
- **Implizite m:n-Relationen brauchen beide Seiten.** Fehlt eine, meldet `prisma validate` „missing an opposite relation field" – und zwar am *anderen* Modell als dem, das man gerade bearbeitet hat.
- **`serializeSpot` wird auch aus POST und PATCH aufgerufen**, wo `spotInclude` ohne Filter greift. Deshalb die `?? []`-Absicherung in Task 4.

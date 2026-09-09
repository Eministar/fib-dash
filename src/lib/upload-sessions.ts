import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ALLOWED_CLIP_TYPES, clipMaxBytes } from './clips'
import { evidenceTypes } from './corruption-evidence'
import { MAX_IMAGE_BYTES } from './investigation-photos'
import { prisma } from './prisma'
import { matchesFileSignature } from './upload-signatures'
import { uploadDir, uploadMaxBytes } from './uploads'
import type { UploadKind } from './upload-kinds'
import type { UploadSession } from '@/generated/prisma'

export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type { UploadKind }

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
  return Object.fromEntries(
    Object.entries(types).map(([mime, ext]) => [mime, ext.startsWith('.') ? ext : `.${ext}`]),
  )
}

/**
 * Was je Upload-Art erlaubt ist. Die Grenzen kommen aus den bestehenden
 * Modulen, damit es nicht zwei Wahrheiten über dieselbe Zahl gibt.
 */
export const uploadKindRules: Record<UploadKind, { maxBytes: () => number; types: Record<string, string> }> = {
  CLIP: { maxBytes: clipMaxBytes, types: ALLOWED_CLIP_TYPES },
  EVIDENCE: { maxBytes: () => 500 * 1024 * 1024, types: withDots(evidenceTypes) },
  PHOTO: {
    maxBytes: () => MAX_IMAGE_BYTES,
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

/** cuid, wie Prisma sie erzeugt — bewusst eng, weil daraus ein Pfad wird. */
function assertSessionId(sessionId: string) {
  if (!/^[a-z0-9]{18,32}$/i.test(sessionId)) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
}

export function incomingDir(sessionId: string) {
  assertSessionId(sessionId)
  const base = path.join(/*turbopackIgnore: true*/ uploadDir(), 'incoming')
  const target = path.normalize(path.join(/*turbopackIgnore: true*/ base, sessionId))
  if (!target.startsWith(`${base}${path.sep}`)) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
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
    .filter((name) => /^\d+\.part$/.test(name))
    .map((name) => Number.parseInt(name.slice(0, -'.part'.length), 10))
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((a, b) => a - b)
}

/**
 * Schreibt einen Chunk nach `<index>.<uuid>.tmp` und benennt ihn erst nach
 * bestandener Prüfung auf `<index>.part` um. Dadurch existiert ein `.part`
 * ausschließlich für vollständige, verifizierte Daten — und der Fortschritt
 * lässt sich allein aus dem Ordner ablesen.
 *
 * Der zufällige Zwischenname verhindert, dass zwei gleichzeitige Zustellungen
 * desselben Index einander die Datei unter den Füßen wegziehen.
 */
export async function storeChunk(
  sessionId: string,
  index: number,
  body: ReadableStream<Uint8Array>,
  expectedSha256: string,
  expectedBytes: number,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new UploadSessionError('Ungültige Prüfsumme')
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new UploadSessionError('Ungültige Chunk-Größe')
  }

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

/**
 * Legt eine Sitzung an — oder liefert die vorhandene zurück, wenn dieselbe
 * Datei schon einmal angefangen wurde. Genau darin besteht das Fortsetzen; der
 * Browser muss sich dafür nichts merken.
 */
export async function openUploadSession(input: OpenUploadSessionInput) {
  const rules = uploadKindRules[input.kind]
  if (!rules) throw new UploadSessionError('Unbekannte Upload-Art')
  if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new UploadSessionError('Ungültige Dateigröße')
  }
  if (input.totalBytes > rules.maxBytes()) {
    throw new UploadSessionError(
      `Datei ist zu groß (max. ${Math.floor(rules.maxBytes() / (1024 * 1024))} MB)`,
      413,
    )
  }
  if (!rules.types[input.mimeType]) {
    throw new UploadSessionError('Nicht unterstütztes Dateiformat', 415)
  }

  const existing = await prisma.uploadSession.findFirst({
    where: { ownerId: input.ownerId, kind: input.kind, fingerprint: input.fingerprint, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  })

  // Gleiche Datei, gleiche Größe: da machen wir weiter. Weicht die Größe ab,
  // hat sich die Datei geändert und die alte Sitzung ist wertlos.
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

export async function loadOwnedSessionUnchecked(sessionId: string): Promise<UploadSession> {
  assertSessionId(sessionId)
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  return session
}

/**
 * Eine fremde Sitzung antwortet wie eine nicht vorhandene: dass es sie gibt,
 * ist keine Information, die wir preisgeben müssen.
 */
export async function loadOwnedSession(sessionId: string, ownerId: string): Promise<UploadSession> {
  const session = await loadOwnedSessionUnchecked(sessionId)
  if (session.ownerId !== ownerId) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  return session
}

export async function cancelUploadSession(sessionId: string, ownerId: string) {
  const session = await loadOwnedSession(sessionId, ownerId)
  await rm(incomingDir(session.id), { recursive: true, force: true })
  await prisma.uploadSession.delete({ where: { id: session.id } }).catch(() => {})
}

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
 * gleichzeitige Aufrufe oder zwei Serverinstanzen nicht beide zusammensetzen —
 * dasselbe Muster wie compressNextClip() in clip-compression.ts.
 */
export async function assembleUploadSession(sessionId: string, ownerId: string) {
  const session = await loadOwnedSession(sessionId, ownerId)
  if (session.status === 'DONE' && session.sha256) {
    return {
      sessionId: session.id,
      sizeBytes: Number(session.totalBytes),
      mimeType: session.mimeType,
      sha256: session.sha256,
    }
  }

  // Fehlende Teile sind kein Scheitern der Sitzung, sondern "noch nicht so
  // weit". Deshalb wird das vor dem Claim geprueft: die Sitzung bleibt OPEN
  // und ein spaeterer Versuch mit vollstaendigen Chunks kommt durch.
  const present = await receivedChunkIndexes(session.id)
  if (present.length !== session.chunkCount) {
    throw new UploadSessionError(
      `Es fehlen ${session.chunkCount - present.length} von ${session.chunkCount} Teilen`,
      409,
    )
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

  const extension = uploadKindRules[session.kind as UploadKind].types[session.mimeType]!
  const target = stagedPath(session.id, extension)

  const fail = async (message: string, status: number): Promise<never> => {
    await prisma.uploadSession.updateMany({
      where: { id: session.id, status: 'ASSEMBLING' },
      data: { status: 'FAILED', error: message.slice(0, 300), assembleStartedAt: null },
    })
    await unlink(target).catch(() => {})
    throw new UploadSessionError(message, status)
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
    await new Promise<void>((resolve, reject) =>
      output.end((cause?: Error | null) => (cause ? reject(cause) : resolve())),
    )
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
 * endgültigen Dateinamen zurück. Der Übergang DONE -> CONSUMED ist ein
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
    await prisma.uploadSession.updateMany({
      where: { id: session.id, status: 'CONSUMED' },
      data: { status: 'DONE' },
    })
    throw cause
  }
}

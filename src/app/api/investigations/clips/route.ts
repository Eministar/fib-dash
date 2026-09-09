import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { clipDir, deleteClipFile, formatBytes, resolveClipPath } from '@/lib/clips'
import { queueDiscordInvestigationEvent } from '@/lib/discord-integration'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  investigationAccessInclude,
  sanitizeTags,
  serializeBigInts,
} from '@/lib/investigations'
import { agentDisplayName, cleanText, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'
import { queueClipCompression } from '@/lib/clip-compression'
import { bodycamAccess } from '@/lib/bodycam-access'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'
import { consumeUploadSession, UploadSessionError } from '@/lib/upload-sessions'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { z } from 'zod'

export const OPTIONS = uploadOptions
export async function POST(req: NextRequest) { return uploadCors(req, await uploadClip(req)) }
export async function GET(req: NextRequest) { return uploadCors(req, await listClips(req)) }

export const dynamic = 'force-dynamic'

const clipInclude = {
  investigation: { select: { id: true, caseNumber: true, title: true, classified: true } },
  entry: { select: { id: true, title: true, kind: true } },
  recordedByAgent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      rank: { select: { id: true, name: true, color: true } },
    },
  },
  uploadedBy: { select: { id: true, displayName: true } },
} as const

const uploadSchema = z
  .object({
    uploadId: z.string().trim().min(1).max(64),
    investigationId: z.string().trim().min(1).max(64),
    entryId: z.string().trim().min(1).max(64).nullish(),
    title: z.string().trim().min(1, 'Titel des Clips ist erforderlich').max(200, 'Titel ist zu lang (max. 200 Zeichen)'),
    description: z.string().trim().max(5000).nullish(),
    location: z.string().trim().max(200).nullish(),
    recordedAt: z.string().trim().nullish(),
    recordedByAgentId: z.string().trim().min(1).max(64).nullish(),
    durationSeconds: z.number().nullish(),
    tags: z.array(z.string()).max(50).optional(),
  })
  .strict()

/**
 * Verschiebt die fertig geprüfte Datei aus der Zwischenablage ins
 * Clip-Verzeichnis. Beide liegen unter `uploadDir()`, ein `rename` genügt also
 * normalerweise; über Dateisystemgrenzen hinweg scheitert es mit `EXDEV` und
 * wird zu Kopieren-und-Löschen.
 */
async function adoptClipFile(source: string, extension: string) {
  const filename = `${randomUUID()}${extension}`
  const target = resolveClipPath(filename)
  await mkdir(clipDir(), { recursive: true })
  try {
    await rename(source, target)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
    await copyFile(source, target)
    await unlink(source).catch(() => {})
  }
  return filename
}

async function listClips(req: NextRequest) {
  try {
    const access = await bodycamAccess()
    const { searchParams } = req.nextUrl

    const investigationId = searchParams.get('investigationId')?.trim()
    const agentId = searchParams.get('recordedByAgentId')?.trim()
    const search = searchParams.get('search')?.trim()
    const from = searchParams.get('from')?.trim()
    const to = searchParams.get('to')?.trim()

    const filters: Prisma.BodycamClipWhereInput[] = [
      { investigation: access.where },
    ]

    if (investigationId) filters.push({ investigationId })
    if (agentId) filters.push({ recordedByAgentId: agentId })

    if (search) {
      filters.push({
        OR: [
          { title: { contains: search } },
          { description: { contains: search } },
          { location: { contains: search } },
          { investigation: { caseNumber: { contains: search } } },
          { investigation: { title: { contains: search } } },
        ],
      })
    }

    const fromDate = parseDate(from)
    const toDate = parseDate(to)
    if (fromDate || toDate) {
      filters.push({
        recordedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      })
    }

    const clips = await prisma.bodycamClip.findMany({
      where: { AND: filters },
      include: clipInclude,
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    })

    return success(serializeBigInts(clips))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

async function uploadClip(req: NextRequest) {
  let storedFilename: string | null = null

  try {
    const user = await requirePermission('investigations:manage')

    // Die Videodaten sind bereits ueber /api/uploads eingetroffen und geprueft;
    // hier reisen nur noch die Metadaten plus das Ticket.
    const meta = uploadSchema.parse(await req.json())
    const investigationId = meta.investigationId
    const title = meta.title

    const investigation = await prisma.investigation.findUnique({
      where: { id: investigationId },
      include: {
        ...investigationAccessInclude,
        leadAgent: { select: { discordId: true, firstName: true, lastName: true, badgeNumber: true } },
      },
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const entryId = cleanText(meta.entryId ?? '') || null
    if (entryId) {
      const entry = await prisma.investigationEntry.findUnique({
        where: { id: entryId },
        select: { investigationId: true },
      })
      if (!entry) return notFound('Eintrag')
      if (entry.investigationId !== investigationId) {
        return error('Der Eintrag gehört nicht zu dieser Akte')
      }
    }

    const recordedByAgentId = cleanText(meta.recordedByAgentId ?? '') || null
    if (recordedByAgentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: recordedByAgentId },
        select: { id: true },
      })
      if (!agent) return notFound('Agent')
    }

    const stored = await consumeUploadSession(meta.uploadId, user.id, 'CLIP', adoptClipFile)
    const { filename, sizeBytes, mimeType, originalName } = stored
    storedFilename = filename

    const durationRaw = Number(meta.durationSeconds)
    const durationSeconds =
      Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null

    const clip = await prisma.bodycamClip.create({
      data: {
        investigationId,
        entryId,
        title,
        description: cleanText(meta.description) || null,
        recordedAt: parseDate(meta.recordedAt),
        location: cleanText(meta.location).slice(0, 200) || null,
        filename,
        originalName: (originalName || filename).slice(0, 255),
        sizeBytes: BigInt(sizeBytes),
        mimeType,
        durationSeconds,
        recordedByAgentId,
        tags: sanitizeTags(meta.tags),
        uploadedById: user.id,
      },
      include: clipInclude,
    })

    // Ab hier ist die Datei über den Datensatz erreichbar und darf im
    // Fehlerpfad nicht mehr weggeräumt werden.
    storedFilename = null
    queueClipCompression()

    await prisma.investigation.update({
      where: { id: investigationId },
      data: { updatedAt: new Date() },
    })

    await createAuditLog({
      action: 'CLIP_UPLOADED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: Clip "${title}" hochgeladen (${formatBytes(sizeBytes)})`,
    })

    queueDiscordInvestigationEvent({
      type: 'clip',
      caseNumber: investigation.caseNumber,
      title: investigation.title,
      classified: investigation.classified,
      leadAgentName: agentDisplayName(investigation.leadAgent),
      actorName: user.displayName,
      note: title,
      rows: [{ label: 'Größe', value: formatBytes(sizeBytes) }],
    })

    return success(serializeBigInts(clip), 201)
  } catch (cause: unknown) {
    // Angefangene Uploads hinterlassen keine verwaisten Dateien.
    if (storedFilename) await deleteClipFile(storedFilename)
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}

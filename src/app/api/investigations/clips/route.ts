import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit/audit'
import { deleteClipFile, formatBytes, resolveClipPath } from '@/lib/media/clips'
import { adoptUploadedFile } from '@/lib/media/upload-adopt'
import { queueDiscordInvestigationEvent } from '@/lib/discord/discord-integration'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  investigationAccessInclude,
  sanitizeTags,
  serializeBigInts,
} from '@/lib/investigations/investigations'
import { agentDisplayName, cleanText, parseDate, routeError } from '@/lib/investigations/investigations-server'
import { agentRecordInput } from '@/lib/agents/agent-records'
import type { Prisma } from '@/generated/prisma'
import { queueClipCompression } from '@/lib/media/clip-compression'
import { bodycamAccess, canManageAgentRecordClip } from '@/lib/investigations/bodycam-access'
import { hasPermission } from '@/lib/permissions'
import { uploadCors, uploadOptions } from '@/lib/media/upload-cors'
import { consumeUploadSession, UploadSessionError } from '@/lib/media/upload-sessions'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const OPTIONS = uploadOptions
export async function POST(req: NextRequest) { return uploadCors(req, await uploadClip(req)) }
export async function GET(req: NextRequest) { return uploadCors(req, await listClips(req)) }

export const dynamic = 'force-dynamic'

const clipInclude = {
  investigation: { select: { id: true, caseNumber: true, title: true } },
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
    /** Ermittlungsakte – oder stattdessen `agentRecord`. */
    investigationId: z.string().trim().min(1).max(64).nullish(),
    /** Statt einer Akte: neuer Eintrag in einer Agent-Akte, an dem der Clip als Beweis hängt. */
    agentRecord: agentRecordInput.extend({ agentId: z.string().trim().min(1).max(64) }).optional(),
    entryId: z.string().trim().min(1).max(64).nullish(),
    title: z.string().trim().min(1, 'Titel des Clips ist erforderlich').max(200, 'Titel ist zu lang (max. 200 Zeichen)'),
    description: z.string().trim().max(5000).nullish(),
    location: z.string().trim().max(200).nullish(),
    recordedAt: z.string().trim().nullish(),
    recordedByAgentId: z.string().trim().min(1).max(64).nullish(),
    durationSeconds: z.number().nullish(),
    tags: z.array(z.string()).max(50).optional(),
    /** Von der Desktop-App bereits komprimiert (H.264/MP4) – der Server wandelt nicht erneut um. */
    clientCompressed: z.boolean().optional(),
  })
  .strict()
  .refine((meta) => Boolean(meta.investigationId) !== Boolean(meta.agentRecord), {
    message: 'Bitte entweder eine Ermittlungsakte oder eine Agent-Akte wählen',
  })

/** Legt die geprüfte Datei unter einem neuen Namen im Clip-Verzeichnis ab. */
async function adoptClipFile(source: string, extension: string) {
  return adoptUploadedFile(source, resolveClipPath(`${randomUUID()}${extension}`))
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
      // Clips aus Agent-Akten gehören nicht in den Bodycam-Katalog (eigene Rechte).
      { investigationId: { not: null } },
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

type UploadMeta = z.infer<typeof uploadSchema>

/** Felder eines neuen Clips, gleich ob er an einer Akte oder einer Agent-Akte hängt. */
function clipFields(meta: UploadMeta, stored: { filename: string; sizeBytes: number; mimeType: string; originalName: string | null }, userId: string, recordedByAgentId: string | null) {
  const durationRaw = Number(meta.durationSeconds)
  return {
    title: meta.title,
    description: cleanText(meta.description) || null,
    recordedAt: parseDate(meta.recordedAt),
    location: cleanText(meta.location).slice(0, 200) || null,
    filename: stored.filename,
    originalName: (stored.originalName || stored.filename).slice(0, 255),
    sizeBytes: BigInt(stored.sizeBytes),
    mimeType: stored.mimeType,
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null,
    recordedByAgentId,
    tags: sanitizeTags(meta.tags),
    uploadedById: userId,
    ...(meta.clientCompressed
      ? { compressionStatus: 'SKIPPED', compressionError: 'Bereits in der Desktop-App komprimiert' }
      : {}),
  }
}

async function uploadClip(req: NextRequest) {
  let storedFilename: string | null = null

  try {
    const user = await requireAuth()

    // Die Videodaten sind bereits ueber /api/uploads eingetroffen und geprueft;
    // hier reisen nur noch die Metadaten plus das Ticket.
    const meta = uploadSchema.parse(await req.json())
    const title = meta.title

    const recordedByAgentId = cleanText(meta.recordedByAgentId ?? '') || null
    if (recordedByAgentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: recordedByAgentId },
        select: { id: true },
      })
      if (!agent) return notFound('Agent')
    }

    // Beweis zu einem neuen Eintrag in einer Agent-Akte (Rechte wie für Akteneinträge).
    if (meta.agentRecord) {
      if (!canManageAgentRecordClip(user)) return forbidden()
      const record = meta.agentRecord
      const agent = await prisma.agent.findUnique({ where: { id: record.agentId }, select: { id: true } })
      if (!agent) return notFound('Agent')

      const stored = await consumeUploadSession(meta.uploadId, user.id, 'CLIP', adoptClipFile)
      storedFilename = stored.filename
      const label = record.kind === 'POSITIVE' ? 'Positiver' : 'Negativer'
      const clip = await prisma.$transaction(async (tx) => {
        const entry = await tx.agentRecordEntry.create({
          data: { agentId: record.agentId, kind: record.kind, title: record.title, content: record.content, source: 'manual', authorId: user.id },
        })
        await createAuditLog({
          action: 'AGENT_RECORD_CREATED',
          userId: user.id,
          agentId: record.agentId,
          details: `${label} Eintrag mit Bodycam-Clip: ${record.title} (${formatBytes(stored.sizeBytes)})`,
        }, tx)
        return tx.bodycamClip.create({
          data: { agentRecordEntryId: entry.id, ...clipFields(meta, stored, user.id, recordedByAgentId) },
          include: clipInclude,
        })
      })
      // Ab hier ist die Datei über den Datensatz erreichbar.
      storedFilename = null
      if (!meta.clientCompressed) queueClipCompression()
      return success(serializeBigInts(clip), 201)
    }

    if (!hasPermission(user, 'investigations:manage')) return forbidden()
    const investigationId = meta.investigationId
    if (!investigationId) return error('Bitte eine Ermittlungsakte auswählen')

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

    const stored = await consumeUploadSession(meta.uploadId, user.id, 'CLIP', adoptClipFile)
    const { sizeBytes } = stored
    storedFilename = stored.filename

    const clip = await prisma.bodycamClip.create({
      data: { investigationId, entryId, ...clipFields(meta, stored, user.id, recordedByAgentId) },
      include: clipInclude,
    })

    // Ab hier ist die Datei über den Datensatz erreichbar und darf im
    // Fehlerpfad nicht mehr weggeräumt werden.
    storedFilename = null
    if (!meta.clientCompressed) queueClipCompression()

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
      investigationId: investigation.id,
      clipId: clip.id,
      caseNumber: investigation.caseNumber,
      title: investigation.title,
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

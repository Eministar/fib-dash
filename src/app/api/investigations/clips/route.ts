import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  ClipTooLargeError,
  clipExtensionFor,
  clipMaxBytes,
  deleteClipFile,
  formatBytes,
  saveClipStream,
} from '@/lib/clips'
import { queueDiscordInvestigationEvent } from '@/lib/discord-integration'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  investigationVisibilityWhere,
  sanitizeTags,
  serializeBigInts,
} from '@/lib/investigations'
import { agentDisplayName, cleanText, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

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

/**
 * Die Metadaten reisen als base64-kodiertes JSON im Header `x-clip-meta` mit,
 * damit der Request-Body allein die Videodaten trägt. So kann der Upload direkt
 * auf die Platte gestreamt werden, statt als multipart im Speicher zu landen.
 */
function parseClipMeta(header: string | null): Record<string, unknown> {
  if (!header) throw new Error('Clip-Metadaten fehlen')

  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Clip-Metadaten sind ungültig')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('Clip-Metadaten sind ungültig')
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const { searchParams } = req.nextUrl

    const investigationId = searchParams.get('investigationId')?.trim()
    const agentId = searchParams.get('recordedByAgentId')?.trim()
    const search = searchParams.get('search')?.trim()
    const from = searchParams.get('from')?.trim()
    const to = searchParams.get('to')?.trim()

    const filters: Prisma.BodycamClipWhereInput[] = [
      { investigation: investigationVisibilityWhere(user) },
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

export async function POST(req: NextRequest) {
  let storedFilename: string | null = null

  try {
    const user = await requirePermission('investigations:manage')

    const mimeType = (req.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
    if (!clipExtensionFor(mimeType)) {
      return error('Nicht unterstütztes Videoformat (erlaubt: MP4, WebM, MOV, MKV)', 415)
    }

    // Frühzeitige Ablehnung, bevor überhaupt Daten geschrieben werden.
    const declaredLength = Number.parseInt(req.headers.get('content-length') || '', 10)
    const maxBytes = clipMaxBytes()
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return error(`Clip ist zu groß (max. ${formatBytes(maxBytes)})`, 413)
    }

    const meta = parseClipMeta(req.headers.get('x-clip-meta'))

    const investigationId = cleanText(meta.investigationId)
    if (!investigationId) return error('Ermittlungsakte ist erforderlich')

    const title = cleanText(meta.title)
    if (!title) return error('Titel des Clips ist erforderlich')
    if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')

    const investigation = await prisma.investigation.findUnique({
      where: { id: investigationId },
      include: {
        leadAgent: { select: { discordId: true, firstName: true, lastName: true, badgeNumber: true } },
        assignees: { select: { userId: true } },
      },
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const entryId = cleanText(meta.entryId) || null
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

    const recordedByAgentId = cleanText(meta.recordedByAgentId) || null
    if (recordedByAgentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: recordedByAgentId },
        select: { id: true },
      })
      if (!agent) return notFound('Agent')
    }

    if (!req.body) return error('Es wurden keine Videodaten übertragen')

    const { filename, sizeBytes } = await saveClipStream(req.body, mimeType)
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
        originalName: (cleanText(meta.originalName) || filename).slice(0, 255),
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
    if (cause instanceof ClipTooLargeError) return error(cause.message, 413)
    return routeError(cause)
  }
}

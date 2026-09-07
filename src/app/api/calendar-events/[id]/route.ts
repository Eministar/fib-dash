import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requireCalendarModuleManage } from '@/lib/module-permissions'

const EVENT_TYPES = new Set(['TRAINING', 'MEETING', 'ACADEMY', 'EXAM', 'HR_DEADLINE', 'SRU_TRAINING', 'SRU_OPERATION', 'AIR_SUPPORT_TRAINING', 'AIR_SUPPORT_OPERATION', 'OTHER'])
type CalendarEventTypeValue = 'TRAINING' | 'MEETING' | 'ACADEMY' | 'EXAM' | 'HR_DEADLINE' | 'SRU_TRAINING' | 'SRU_OPERATION' | 'AIR_SUPPORT_TRAINING' | 'AIR_SUPPORT_OPERATION' | 'OTHER'

function eventType(value: string): CalendarEventTypeValue | null {
  return EVENT_TYPES.has(value) ? value as CalendarEventTypeValue : null
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const existing = await prisma.calendarEvent.findUnique({ where: { id } })
    if (!existing) return notFound('Termin')
    const user = await requireCalendarModuleManage(existing.module)

    const data: Record<string, unknown> = {}
    if ('title' in body) {
      const title = cleanText(body.title)
      if (!title) return error('Titel ist erforderlich')
      data.title = title
    }
    if ('description' in body) data.description = cleanText(body.description) || null
    if ('location' in body) data.location = cleanText(body.location) || null
    if ('type' in body) {
      const type = eventType(cleanText(body.type).toUpperCase())
      if (!type) return error('Terminart ist ungültig')
      data.type = type
    }
    if ('startsAt' in body) {
      const startsAt = parseDate(body.startsAt)
      if (!startsAt) return error('Startzeit ist ungültig')
      data.startsAt = startsAt
    }
    if ('endsAt' in body) {
      const endsAt = parseDate(body.endsAt)
      data.endsAt = endsAt ?? null
    }
    if ('agentId' in body) {
      const agentId = cleanText(body.agentId)
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
        if (!agent) return error('Agent nicht gefunden', 404)
      }
      data.agentId = agentId || null
    }
    if ('discordAnnouncement' in body) data.discordAnnouncement = body.discordAnnouncement === true

    const nextStart = data.startsAt instanceof Date ? data.startsAt : existing.startsAt
    const nextEnd = data.endsAt instanceof Date ? data.endsAt : data.endsAt === null ? null : existing.endsAt
    if (nextEnd && nextEnd < nextStart) return error('Endzeit darf nicht vor dem Start liegen')

    const event = await prisma.calendarEvent.update({
      where: { id },
      data,
      include: {
        agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, rank: true } },
        createdBy: { select: { displayName: true } },
      },
    })

    await createAuditLog({
      action: 'CALENDAR_EVENT_UPDATED',
      userId: user.id,
      agentId: event.agentId ?? undefined,
      details: event.title,
    })

    return success(event)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const event = await prisma.calendarEvent.findUnique({ where: { id } })
    if (!event) return notFound('Termin')
    const user = await requireCalendarModuleManage(event.module)

    await prisma.calendarEvent.delete({ where: { id } })
    await createAuditLog({
      action: 'CALENDAR_EVENT_DELETED',
      userId: user.id,
      agentId: event.agentId ?? undefined,
      details: event.title,
    })

    return success({ message: 'Termin gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

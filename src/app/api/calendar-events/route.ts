import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordHrEvent } from '@/lib/discord-integration'
import { isTaskModule, taskModuleOrNull, requireCalendarModuleManage, requireCalendarModuleView } from '@/lib/module-permissions'

const EVENT_TYPES = new Set(['TRAINING', 'MEETING', 'ACADEMY', 'EXAM', 'HR_DEADLINE', 'SRU_TRAINING', 'SRU_OPERATION', 'AIR_SUPPORT_TRAINING', 'AIR_SUPPORT_OPERATION', 'OTHER'])
type CalendarEventTypeValue = 'TRAINING' | 'MEETING' | 'ACADEMY' | 'EXAM' | 'HR_DEADLINE' | 'SRU_TRAINING' | 'SRU_OPERATION' | 'AIR_SUPPORT_TRAINING' | 'AIR_SUPPORT_OPERATION' | 'OTHER'

const EVENT_TYPE_LABELS: Record<CalendarEventTypeValue, string> = {
  TRAINING: 'Training',
  MEETING: 'Besprechung',
  ACADEMY: 'Academy',
  EXAM: 'Prüfung',
  HR_DEADLINE: 'HR-Frist',
  SRU_TRAINING: 'S.R.U.-Training',
  SRU_OPERATION: 'S.R.U.-Einsatz',
  AIR_SUPPORT_TRAINING: 'Air-Support-Training',
  AIR_SUPPORT_OPERATION: 'Air-Support-Einsatz',
  OTHER: 'Sonstiges',
}

function eventType(value: string): CalendarEventTypeValue | null {
  return EVENT_TYPES.has(value) ? value as CalendarEventTypeValue : null
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(req: NextRequest) {
  const eventModule = taskModuleOrNull(req.nextUrl.searchParams.get('module'))

  try {
    await requireCalendarModuleView(eventModule)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const from = parseDate(req.nextUrl.searchParams.get('from'))
  const to = parseDate(req.nextUrl.searchParams.get('to'))
  const type = eventType(req.nextUrl.searchParams.get('type') || '')

  const events = await prisma.calendarEvent.findMany({
    where: {
      ...(eventModule ? { module: eventModule } : {}),
      ...(type ? { type } : {}),
      ...(from || to ? {
        startsAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      } : {}),
    },
    include: {
      agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true, rank: true } },
      createdBy: { select: { displayName: true, discordId: true } },
    },
    orderBy: { startsAt: 'asc' },
  })

  return success(events)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const eventModule = isTaskModule(body.module) ? body.module : null
    const user = await requireCalendarModuleManage(eventModule)
    const title = cleanText(body.title)
    const description = cleanText(body.description)
    const location = cleanText(body.location)
    const startsAt = parseDate(body.startsAt)
    const endsAt = parseDate(body.endsAt)
    const type = eventType(cleanText(body.type).toUpperCase() || 'OTHER')
    const agentId = cleanText(body.agentId)

    if (!title) return error('Titel ist erforderlich')
    if (!startsAt) return error('Startzeit ist ungültig')
    if (endsAt && endsAt < startsAt) return error('Endzeit darf nicht vor dem Start liegen')
    if (!type) return error('Terminart ist ungültig')

    if (agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
      if (!agent) return error('Agent nicht gefunden', 404)
    }

    const event = await prisma.calendarEvent.create({
      data: {
        title,
        module: eventModule,
        description: description || null,
        type,
        startsAt,
        endsAt,
        location: location || null,
        agentId: agentId || null,
        createdById: user.id,
        discordAnnouncement: body.discordAnnouncement === true,
      },
      include: {
        agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true, rank: true } },
        createdBy: { select: { displayName: true, discordId: true } },
      },
    })

    await createAuditLog({
      action: 'CALENDAR_EVENT_CREATED',
      userId: user.id,
      agentId: agentId || undefined,
      details: `${title} am ${startsAt.toLocaleString('de-DE')}`,
    })

    if (event.discordAnnouncement) {
      queueDiscordHrEvent({
        type: 'update',
        title: `Termin: ${event.title}`,
        description: description || 'Wir möchten Sie über den nachfolgend aufgeführten Termin informieren.',
        agent: event.agent ?? undefined,
        actor: user,
        fields: [
          { name: 'Art', value: EVENT_TYPE_LABELS[event.type], inline: true },
          { name: 'Start', value: startsAt.toLocaleString('de-DE'), inline: true },
          ...(endsAt ? [{ name: 'Ende', value: endsAt.toLocaleString('de-DE'), inline: true }] : []),
          ...(location ? [{ name: 'Ort', value: location, inline: true }] : []),
        ],
      })
    }

    return success(event, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

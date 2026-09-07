import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import {
  createAbsenceNotice,
  formatAbsenceDate,
  getActiveAbsenceNotices,
  parseAbsenceDate,
  runAgentStatusAutomation,
} from '@/lib/absence-status'
import { queueDiscordAbsenceStatusUpdate, queueDiscordHrEvent } from '@/lib/discord-integration'

export async function GET() {
  try {
    await requirePermission('dashboard:view')
    await runAgentStatusAutomation()
    const active = await getActiveAbsenceNotices()
    return success({ active })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorized()

    const body = await req.json()
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return error('Grund ist erforderlich')

    const startsAt = typeof body.startsAt === 'string'
      ? parseAbsenceDate(body.startsAt) ?? new Date()
      : new Date()
    const endsAt = typeof body.endsAt === 'string'
      ? parseAbsenceDate(body.endsAt, { hours: 23, minutes: 59 })
      : null
    if (!endsAt) return error('Ende ist erforderlich')

    const requestedAgentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    const canManageAgents = hasPermission(user, 'agents:write')
    const agent = requestedAgentId
      ? canManageAgents
        ? await prisma.agent.findUnique({ where: { id: requestedAgentId }, include: { rank: true } })
        : null
      : user.discordId
        ? await prisma.agent.findFirst({
          where: { discordId: user.discordId, status: { not: 'TERMINATED' } },
          include: { rank: true },
        })
        : null

    if (requestedAgentId && !canManageAgents) return error('Keine Berechtigung', 403)
    if (!agent) return error('Kein verknüpfter Agent gefunden')

    const result = await createAbsenceNotice({
      agentId: agent.id,
      startsAt,
      endsAt,
      reason,
      source: 'dashboard',
      actorDiscordId: user.discordId,
    })

    queueDiscordAbsenceStatusUpdate()
    queueDiscordHrEvent({
      type: 'update',
      title: `Abmeldung: ${agent.firstName} ${agent.lastName}`,
      description: 'Für den genannten Zeitraum liegt eine Abmeldung vor.',
      agent: result.agent,
      actor: user,
      fields: [
        { name: 'Von', value: formatAbsenceDate(startsAt), inline: true },
        { name: 'Bis', value: formatAbsenceDate(endsAt), inline: true },
        { name: 'Grund', value: reason, inline: false },
      ],
    })

    return success(result, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

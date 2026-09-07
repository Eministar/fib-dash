import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { cancelAbsenceNotice, formatAbsenceDate } from '@/lib/absence-status'
import { queueDiscordAbsenceStatusUpdate, queueDiscordHrEvent } from '@/lib/discord-integration'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorized()

    const { id } = await params
    const absence = await prisma.absenceNotice.findUnique({
      where: { id },
      include: {
        agent: {
          include: { rank: true },
        },
      },
    })
    if (!absence) return notFound('Abmeldung')

    const isOwner = !!user.discordId && absence.agent.discordId === user.discordId
    if (!isOwner && !hasPermission(user, 'agents:write')) return error('Keine Berechtigung', 403)

    const cancelled = await cancelAbsenceNotice(id)
    queueDiscordAbsenceStatusUpdate()
    queueDiscordHrEvent({
      type: 'update',
      title: `Abmeldung beendet: ${cancelled.agent.firstName} ${cancelled.agent.lastName}`,
      description: 'Die Abmeldung wurde beendet. Der reguläre Dienststatus gilt wieder.',
      agent: cancelled.agent,
      actor: user,
      fields: [
        { name: 'Zeitraum', value: `${formatAbsenceDate(cancelled.startsAt)} bis ${formatAbsenceDate(cancelled.endsAt)}`, inline: false },
        { name: 'Grund', value: cancelled.reason, inline: false },
      ],
    })

    return success({ message: 'Abmeldung beendet' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

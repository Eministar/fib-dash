import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { AGENT_LEAVE_ENDED_ACTION, runAgentStatusAutomation } from '@/lib/absence-status'
import { queueAgentRoleSync, queueDiscordAbsenceStatusUpdate, queueDiscordHrEvent } from '@/lib/discord-integration'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'

const NOTE_TITLE = 'Beurlaubung'

async function setLeave(
  req: NextRequest,
  params: Promise<{ id: string }>,
  onLeave: boolean,
) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['agents:leave'])
    const { id } = await params

    const existing = await prisma.agent.findUnique({ where: { id }, include: { rank: true } })
    if (!existing) return notFound('Agent')

    if (existing.status === 'TERMINATED') {
      return error('Gekündigte Agents können nicht beurlaubt werden.')
    }
    if (existing.onLeave === onLeave) {
      return success(existing)
    }

    let reason = ''
    if (onLeave) {
      const body = await req.json().catch(() => ({}))
      reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
      if (!reason) return error('Grund ist erforderlich')
    }

    const now = new Date()
    await prisma.agent.update({
      where: { id },
      data: onLeave
        ? { onLeave: true, onLeaveSince: now, onLeaveReason: reason }
        : { onLeave: false, onLeaveSince: null, onLeaveReason: null },
    })

    // Automatische Notiz für die Personalakte
    await prisma.note.create({
      data: {
        agentId: id,
        authorId: user.id,
        title: NOTE_TITLE,
        content: onLeave
          ? `Agent wurde beurlaubt. Die Beurlaubung gilt wie eine Abmeldung, bis sie aufgehoben wird.\n\nGrund: ${reason}`
          : 'Beurlaubung aufgehoben. Der reguläre Dienststatus gilt wieder.',
        pinned: onLeave,
      },
    })

    // Das Ende der Beurlaubung wird als Fehlzeit-Reset gewertet (siehe absence-status).
    await createAuditLog({
      action: onLeave ? 'AGENT_LEAVE_STARTED' : AGENT_LEAVE_ENDED_ACTION,
      userId: user.id,
      agentId: id,
      details: `${existing.firstName} ${existing.lastName}: Beurlaubung ${onLeave ? 'gesetzt' : 'aufgehoben'}${onLeave ? ` (${reason})` : ''}`,
    })

    // Status (ON_LEAVE / zurück) und Markierung neu berechnen
    await runAgentStatusAutomation({ force: true })
    const updated = await prisma.agent.findUniqueOrThrow({ where: { id }, include: { rank: true } })

    // Discord-Rolle + Umbenennung ([X]-Marker) anwenden
    await syncLinkedUserDisplayNameForAgent(updated)
    queueAgentRoleSync(id)
    queueDiscordAbsenceStatusUpdate()
    queueDiscordHrEvent({
      type: 'update',
      title: `${onLeave ? 'Beurlaubung' : 'Beurlaubung beendet'}: ${existing.firstName} ${existing.lastName}`,
      description: onLeave
        ? 'Der Agent wurde bis auf Weiteres beurlaubt.'
        : 'Die Beurlaubung wurde aufgehoben. Der reguläre Dienststatus gilt wieder.',
      agent: updated,
      actor: user,
      fields: onLeave ? [{ name: 'Grund', value: reason, inline: false }] : [],
    })

    return success(updated)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return setLeave(req, params, true)
}

export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return setLeave(req, params, false)
}

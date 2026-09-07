import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import {
  PENAL_GRADES,
  cleanSanctionText,
  deleteSanctionDiscordMessage,
  dueAtFromDeadlineDays,
  escalateSanction,
  getSanctionById,
  isSanctionMeasureType,
  normalizeSanctionMeasureType,
  parseDeadlineDays,
  parseDueAt,
  penalGradeLabel,
  sanctionMeasureLabel,
  resolveSanctionMeasure,
  resolveSanctionPenalty,
  sanctionInclude,
  sanctionStatusLabel,
  syncSanctionDiscordMessage,
} from '@/lib/sanctions'

type RouteContext = { params: Promise<{ id: string }> }

function sanctionSummary(sanction: NonNullable<Awaited<ReturnType<typeof getSanctionById>>>) {
  const agentName = sanction.agent
    ? `${sanction.agent.firstName} ${sanction.agent.lastName}`
    : `${sanction.previousFirstName ?? ''} ${sanction.previousLastName ?? ''}`.trim() || 'Unbekannter Agent'
  return `${agentName}: ${penalGradeLabel(sanction.penalGrade)} · ${sanctionMeasureLabel(sanction)} · Status: ${sanctionStatusLabel(sanction.status)}`
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requirePermission('sanctions:manage')
    const { id } = await params
    const body = await req.json()
    const action = cleanSanctionText(body.action).toUpperCase()

    const existing = await getSanctionById(id)
    if (!existing) return notFound('Sanktion')

    if (action === 'MARK_PAID' || action === 'PAID') {
      const now = new Date()
      const updated = await prisma.sanction.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: existing.paidAt ?? now,
          resolvedAt: now,
        },
        include: sanctionInclude,
      })

      await createAuditLog({
        action: 'SANCTION_PAID',
        userId: user.id,
        agentId: updated.agentId ?? undefined,
        oldValue: sanctionStatusLabel(existing.status),
        newValue: sanctionStatusLabel(updated.status),
        details: sanctionSummary(updated),
      })
      await syncSanctionDiscordMessage(updated, { description: 'Sanktion wurde bezahlt.' })
      return success(updated)
    }

    if (action === 'ESCALATE' || action === 'MARK_UNPAID') {
      const result = await escalateSanction(id, { actorUserId: user.id, manual: true })
      if (!result) return error('Sanktion ist nicht mehr offen')
      return success(result)
    }

    const data: Record<string, unknown> = {}
    const changes: string[] = []

    if ('penalGrade' in body || 'measureType' in body) {
      const penalGrade = 'penalGrade' in body
        ? cleanSanctionText(body.penalGrade).toUpperCase()
        : existing.penalGrade
      if (!PENAL_GRADES.has(penalGrade)) return error('Penal Grade ist erforderlich')
      const penaltyRule = resolveSanctionPenalty(penalGrade)
      if (!penaltyRule) return error('Penal Grade ist erforderlich')

      const previousMeasureType = normalizeSanctionMeasureType(existing.measureType)
      const measureType = 'measureType' in body ? body.measureType : previousMeasureType
      if (!isSanctionMeasureType(measureType)) return error('Maßnahme ist ungültig')
      const selectedMeasure = resolveSanctionMeasure(penaltyRule, measureType)

      if (penalGrade !== existing.penalGrade) {
        data.penalGrade = penalGrade
        changes.push(`Penal Grade: ${penalGradeLabel(existing.penalGrade)} → ${penalGradeLabel(penalGrade)}`)
      }
      if (existing.measureType !== measureType) {
        data.measureType = measureType
        if (measureType !== previousMeasureType) {
          changes.push(`Maßnahme: ${sanctionMeasureLabel(existing)} → ${selectedMeasure.label}`)
        }
      }
      if (selectedMeasure.fineAmount !== existing.fineAmount) {
        data.fineAmount = selectedMeasure.fineAmount
      }
      if (selectedMeasure.sgRounds !== existing.sgRounds) {
        data.sgRounds = selectedMeasure.sgRounds
      }
      if (penaltyRule.penalty !== existing.penalty) {
        data.penalty = penaltyRule.penalty
        changes.push(`Grade-Folge: ${existing.penalty ?? '—'} → ${penaltyRule.penalty}`)
      }
      if (measureType === previousMeasureType && (selectedMeasure.fineAmount !== existing.fineAmount || selectedMeasure.sgRounds !== existing.sgRounds)) {
        changes.push(`Maßnahme angepasst: ${sanctionMeasureLabel(existing)} → ${selectedMeasure.label}`)
      }
    }

    if ('reason' in body) {
      const reason = cleanSanctionText(body.reason)
      if (!reason) return error('Grund ist erforderlich')
      if (reason !== existing.reason) {
        data.reason = reason
        changes.push('Grund geändert')
      }
    }

    if ('dueAt' in body) {
      const dueAt = parseDueAt(body.dueAt)
      if (dueAt === undefined) return error('Frist ist ungültig')
      const oldTime = existing.dueAt?.getTime() ?? null
      const newTime = dueAt?.getTime() ?? null
      if (oldTime !== newTime) {
        data.dueAt = dueAt
        changes.push('Frist geändert')
      }
    } else if ('deadlineDays' in body) {
      const deadlineDays = parseDeadlineDays(body.deadlineDays)
      if (deadlineDays === undefined) return error('Frist muss zwischen 1 und 365 Tagen liegen')
      const dueAt = dueAtFromDeadlineDays(deadlineDays)
      data.dueAt = dueAt
      changes.push('Frist geändert')
    }

    if (changes.length === 0) return success(existing)

    const updated = await prisma.sanction.update({
      where: { id },
      data,
      include: sanctionInclude,
    })

    await createAuditLog({
      action: 'SANCTION_UPDATED',
      userId: user.id,
      agentId: updated.agentId ?? undefined,
      oldValue: sanctionSummary(existing),
      newValue: sanctionSummary(updated),
      details: changes.join('; '),
    })
    await syncSanctionDiscordMessage(updated, { note: 'Sanktion wurde bearbeitet.' })

    return success(updated)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requirePermission('sanctions:manage')
    const { id } = await params
    const existing = await getSanctionById(id)
    if (!existing) return notFound('Sanktion')

    await deleteSanctionDiscordMessage(existing)

    await prisma.sanction.delete({ where: { id } })
    await createAuditLog({
      action: 'SANCTION_DELETED',
      userId: user.id,
      agentId: existing.agentId ?? undefined,
      oldValue: sanctionSummary(existing),
      details: 'Sanktion gelöscht',
    })

    return success({ message: 'Sanktion gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

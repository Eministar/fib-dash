import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { hasAnyPermission } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { checkSanctionAuthority } from '@/lib/sanction-authority'
import { assessRepeat } from '@/lib/sanction-repeat'
import {
  cleanSanctionText,
  deleteSanctionDiscordMessage,
  getSanctionById,
  isChecklistComplete,
  isPenalGrade,
  isSanctionLevel,
  normalizeChecklist,
  parseSuspendedUntil,
  penalGradeLabel,
  readCircumstances,
  requiresDualControl,
  resolveSanctionLevel,
  resolveViolation,
  sanctionInclude,
  sanctionLevelLabel,
  sanctionStatusLabel,
  suspendedUntilFromHours,
  syncSanctionDiscordMessage,
} from '@/lib/sanctions'

type RouteContext = { params: Promise<{ id: string }> }

function sanctionSummary(sanction: NonNullable<Awaited<ReturnType<typeof getSanctionById>>>) {
  const agentName = sanction.agent
    ? `${sanction.agent.firstName} ${sanction.agent.lastName}`
    : `${sanction.previousFirstName ?? ''} ${sanction.previousLastName ?? ''}`.trim() || 'Unbekannter Agent'
  return `${agentName}: ${penalGradeLabel(sanction.penalGrade)} · ${sanctionLevelLabel(sanction.level)} · Status: ${sanctionStatusLabel(sanction.status)}`
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requirePermission('sanctions:manage')
    const { id } = await params
    const body = await req.json()
    const action = cleanSanctionText(body.action).toUpperCase()

    const existing = await getSanctionById(id)
    if (!existing) return notFound('Sanktion')

    // -- Zustandswechsel ----------------------------------------------------

    if (action === 'EXECUTE') {
      if (existing.status !== 'ISSUED') return error('Nur ausgesprochene Sanktionen können vollzogen werden')
      if (requiresDualControl(existing.penalGrade) && !existing.confirmedAt) {
        return error('Penal Grade 5 und 6 brauchen zuerst die Bestätigung einer zweiten Führungskraft')
      }

      const updated = await prisma.sanction.update({
        where: { id },
        data: { status: 'EXECUTED', executedAt: new Date() },
        include: sanctionInclude,
      })

      await createAuditLog({
        action: 'SANCTION_EXECUTED',
        userId: user.id,
        agentId: updated.agentId ?? undefined,
        oldValue: sanctionStatusLabel(existing.status),
        newValue: sanctionStatusLabel(updated.status),
        details: sanctionSummary(updated),
      })
      await syncSanctionDiscordMessage(updated, { description: 'Maßnahme wurde vollzogen.' })
      return success(updated)
    }

    if (action === 'CONFIRM') {
      if (!hasAnyPermission(user, ['sanctions:confirm'])) {
        return error('Keine Berechtigung für die Vier-Augen-Bestätigung', 403)
      }
      if (existing.confirmedAt) return error('Sanktion ist bereits bestätigt')
      if (existing.issuedByUserId === user.id) {
        return error('Die Bestätigung muss von einer zweiten Führungskraft kommen')
      }

      const updated = await prisma.sanction.update({
        where: { id },
        data: { confirmedByUserId: user.id, confirmedAt: new Date() },
        include: sanctionInclude,
      })

      await createAuditLog({
        action: 'SANCTION_CONFIRMED',
        userId: user.id,
        agentId: updated.agentId ?? undefined,
        newValue: sanctionSummary(updated),
        details: `Vier-Augen-Bestätigung durch ${user.displayName}`,
      })
      await syncSanctionDiscordMessage(updated, { description: 'Entscheidung wurde von einer zweiten Führungskraft bestätigt.' })
      return success(updated)
    }

    if (action === 'UPHOLD' || action === 'REVOKE') {
      const status = action === 'UPHOLD' ? 'UPHELD' : 'REVOKED'
      if (existing.status === status) return success(existing)

      const updated = await prisma.sanction.update({
        where: { id },
        data: { status, resolvedAt: new Date() },
        include: sanctionInclude,
      })

      await createAuditLog({
        action: action === 'UPHOLD' ? 'SANCTION_UPHELD' : 'SANCTION_REVOKED',
        userId: user.id,
        agentId: updated.agentId ?? undefined,
        oldValue: sanctionStatusLabel(existing.status),
        newValue: sanctionStatusLabel(updated.status),
        details: sanctionSummary(updated),
      })
      await syncSanctionDiscordMessage(updated, {
        description: action === 'UPHOLD'
          ? 'Sanktion wurde nach Prüfung bestätigt.'
          : 'Sanktion wurde aufgehoben und zählt nicht als Vorverstoß.',
      })
      return success(updated)
    }

    // -- Feldänderungen -----------------------------------------------------

    const data: Record<string, unknown> = {}
    const changes: string[] = []

    const nextGrade = 'penalGrade' in body ? cleanSanctionText(body.penalGrade) : existing.penalGrade
    if (!isPenalGrade(nextGrade)) return error('Penal Grade ist erforderlich (1 bis 6)')

    const nextLevelValue = 'level' in body ? cleanSanctionText(body.level) : existing.level
    if (!isSanctionLevel(nextLevelValue)) return error('Sanktionsstufe ist ungültig (01 bis 07)')

    if (nextGrade !== existing.penalGrade || nextLevelValue !== existing.level) {
      const authority = await checkSanctionAuthority({
        userId: user.id,
        grade: nextGrade,
        level: nextLevelValue,
        targetAgentId: existing.agentId,
        override: hasAnyPermission(user, ['sanctions:override-authority']),
      })
      if (!authority.allowed) return error(authority.reason ?? 'Keine Zuständigkeit für diese Sanktionsstufe', 403)
    }

    if (nextGrade !== existing.penalGrade) {
      data.penalGrade = nextGrade
      changes.push(`Penal Grade: ${penalGradeLabel(existing.penalGrade)} → ${penalGradeLabel(nextGrade)}`)
    }
    if (nextLevelValue !== existing.level) {
      data.level = nextLevelValue
      changes.push(`Sanktionsstufe: ${sanctionLevelLabel(existing.level)} → ${sanctionLevelLabel(nextLevelValue)}`)
    }

    if ('violationCode' in body) {
      const violationCode = cleanSanctionText(body.violationCode) || null
      if (violationCode) {
        const violation = resolveViolation(violationCode)
        if (!violation) return error('Verstoß ist im Katalog nicht hinterlegt')
        if (violation.grade !== nextGrade) {
          return error(`"${violation.label}" gehört zu Penal Grade ${violation.grade}, nicht zu ${nextGrade}`)
        }
      }
      if (violationCode !== existing.violationCode) {
        data.violationCode = violationCode
        changes.push(`Verstoß: ${resolveViolation(existing.violationCode)?.label ?? '—'} → ${resolveViolation(violationCode)?.label ?? '—'}`)

        // Der Wiederholungsbezug hängt am Verstoß-Code und wird neu bestimmt.
        const repeat = await assessRepeat({
          agentId: existing.agentId,
          grade: nextGrade,
          violationCode,
          excludeSanctionId: existing.id,
        })
        data.repeatOfSanctionId = repeat.occurrence > 1 ? repeat.repeatOfSanctionId : null
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

    if ('penalty' in body) {
      const penalty = cleanSanctionText(body.penalty) || null
      if (penalty !== existing.penalty) {
        data.penalty = penalty
        changes.push('Weitere Folge geändert')
      }
    }

    if ('mitigating' in body) {
      data.mitigating = readCircumstances(body.mitigating, 'mitigating')
      changes.push('Mildernde Umstände geändert')
    }
    if ('aggravating' in body) {
      data.aggravating = readCircumstances(body.aggravating, 'aggravating')
      changes.push('Erschwerende Umstände geändert')
    }

    if ('checklist' in body) {
      const checklist = normalizeChecklist(body.checklist)
      if (!isChecklistComplete(checklist)) {
        return error('Der Entscheidungs-Check muss vollständig bestätigt sein')
      }
      data.checklist = checklist
      changes.push('Entscheidungs-Check aktualisiert')
    }

    // Suspendierungsende nur, solange die Stufe überhaupt suspendiert.
    const effectiveLevel = resolveSanctionLevel(nextLevelValue)!
    if ('suspendedUntil' in body || 'suspensionHours' in body) {
      if (!effectiveLevel.suspends) {
        data.suspendedUntil = null
      } else {
        const explicit = 'suspendedUntil' in body ? parseSuspendedUntil(body.suspendedUntil) : null
        if (explicit === undefined) return error('Suspendierungsende ist ungültig')
        const fromHours = 'suspensionHours' in body ? suspendedUntilFromHours(body.suspensionHours) : null
        if (fromHours === undefined) return error('Suspendierungsdauer muss zwischen 1 und 8760 Stunden liegen')
        const nextUntil = explicit ?? fromHours
        if ((nextUntil?.getTime() ?? null) !== (existing.suspendedUntil?.getTime() ?? null)) {
          data.suspendedUntil = nextUntil
          changes.push('Suspendierungsende geändert')
        }
      }
    } else if (!effectiveLevel.suspends && existing.suspendedUntil) {
      // Stufenwechsel weg von der Suspendierung räumt das Datum mit auf.
      data.suspendedUntil = null
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

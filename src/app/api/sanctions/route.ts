import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { hasAnyPermission } from '@/lib/permissions'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { checkSanctionAuthority } from '@/lib/sanction-authority'
import { assessRepeat } from '@/lib/sanction-repeat'
import {
  cleanSanctionText,
  isChecklistComplete,
  isPenalGrade,
  isSanctionLevel,
  normalizeChecklist,
  parseSuspendedUntil,
  penalGradeLabel,
  readCircumstances,
  regularLevelForGrade,
  requiresDualControl,
  resolveSanctionLevel,
  resolveViolation,
  sanctionInclude,
  sanctionLevelLabel,
  suspendedUntilFromHours,
  syncSanctionDiscordMessage,
} from '@/lib/sanctions'

/** Obergrenze der Liste — die Seite filtert clientseitig, der Payload bleibt so beschränkt. */
const SANCTION_LIST_LIMIT = 1000

/**
 * Departmentweite Sanktionsliste für die Übersichtsseite.
 *
 * Bewusst ohne Permission-Check: jeder eingeloggte Agent darf Sanktionen
 * einsehen. Ausstellen und Verwalten bleiben auf `sanctions:manage`
 * (siehe POST hier und PATCH/DELETE in `[id]/route.ts`).
 */
export async function GET() {
  try {
    await requireAuth()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }

  const sanctions = await prisma.sanction.findMany({
    include: {
      agent: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          badgeNumber: true,
          status: true,
          rank: { select: { name: true, color: true } },
        },
      },
      issuedBy: { select: { displayName: true } },
      confirmedBy: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: SANCTION_LIST_LIMIT,
  })

  return success(sanctions)
}

/**
 * Sanktion nach dem Sanktionskatalog v1.0 aussprechen.
 *
 * Reihenfolge der Prüfungen folgt dem Entscheidungs-Check (Abschnitt 07):
 * Einstufung → Zuständigkeit → Wiederholungsfall → Checkliste vollständig.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('sanctions:manage')
    const body = await req.json()

    const agentId = cleanSanctionText(body.agentId)
    const reason = cleanSanctionText(body.reason)
    const penalGrade = cleanSanctionText(body.penalGrade)
    const violationCode = cleanSanctionText(body.violationCode) || null
    const penalty = cleanSanctionText(body.penalty) || null

    if (!agentId) return error('Agent ist erforderlich')
    if (!reason) return error('Grund ist erforderlich')
    if (!isPenalGrade(penalGrade)) return error('Penal Grade ist erforderlich (1 bis 6)')

    // Ohne ausdrückliche Stufe gilt die Regelsanktion des Grades.
    const level = 'level' in body && body.level ? cleanSanctionText(body.level) : regularLevelForGrade(penalGrade)
    if (!isSanctionLevel(level)) return error('Sanktionsstufe ist ungültig (01 bis 07)')
    const levelRule = resolveSanctionLevel(level)!

    if (violationCode) {
      const violation = resolveViolation(violationCode)
      if (!violation) return error('Verstoß ist im Katalog nicht hinterlegt')
      if (violation.grade !== penalGrade) {
        return error(`"${violation.label}" gehört zu Penal Grade ${violation.grade}, nicht zu ${penalGrade}`)
      }
    }

    const checklist = normalizeChecklist(body.checklist)
    if (!isChecklistComplete(checklist)) {
      return error('Der Entscheidungs-Check muss vollständig bestätigt sein')
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { rank: true },
    })
    if (!agent) return error('Agent nicht gefunden')
    if (agent.status === 'TERMINATED') return error('Gekündigte Agents können keine neue Sanktion erhalten')

    const authority = await checkSanctionAuthority({
      userId: user.id,
      grade: penalGrade,
      level,
      targetAgentId: agentId,
      override: hasAnyPermission(user, ['sanctions:override-authority']),
    })
    if (!authority.allowed) return error(authority.reason ?? 'Keine Zuständigkeit für diese Sanktionsstufe', 403)

    // Suspendierung braucht eine Dauer; bei allen anderen Stufen bleibt sie leer.
    let suspendedUntil: Date | null = null
    if (levelRule.suspends) {
      const fromHours = suspendedUntilFromHours(body.suspensionHours)
      if (fromHours === undefined) return error('Suspendierungsdauer muss zwischen 1 und 8760 Stunden liegen')
      const explicit = parseSuspendedUntil(body.suspendedUntil)
      if (explicit === undefined) return error('Suspendierungsende ist ungültig')
      suspendedUntil = explicit ?? fromHours
    }

    const repeat = await assessRepeat({ agentId, grade: penalGrade, violationCode })

    const sanction = await prisma.sanction.create({
      data: {
        agentId,
        reason,
        penalGrade,
        level,
        violationCode,
        penalty,
        suspendedUntil,
        mitigating: readCircumstances(body.mitigating, 'mitigating'),
        aggravating: readCircumstances(body.aggravating, 'aggravating'),
        checklist,
        repeatOfSanctionId: repeat.occurrence > 1 ? repeat.repeatOfSanctionId : null,
        issuedByUserId: user.id,
        previousRank: agent.rank.name,
        previousBadgeNumber: agent.badgeNumber,
        previousFirstName: agent.firstName,
        previousLastName: agent.lastName,
      },
      include: sanctionInclude,
    })

    const repeatNote = repeat.occurrence > 1
      ? ` · Wiederholungsfall (${repeat.occurrence}. gleichartiger Verstoß): ${repeat.principle}`
      : ''
    const dualNote = requiresDualControl(penalGrade) ? ' · Vier-Augen-Bestätigung ausstehend' : ''

    await createAuditLog({
      action: 'AGENT_SANCTIONED',
      userId: user.id,
      agentId,
      newValue: `${penalGradeLabel(penalGrade)} · ${sanctionLevelLabel(level)}`,
      details:
        `${agent.firstName} ${agent.lastName}: ${penalGradeLabel(penalGrade)} · ${sanctionLevelLabel(level)}` +
        `${repeat.violationLabel ? ` · Verstoß: ${repeat.violationLabel}` : ''}` +
        `${repeatNote}${dualNote} · Grund: ${reason}`,
    })

    await syncSanctionDiscordMessage(sanction)

    return success({ sanction, repeat }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

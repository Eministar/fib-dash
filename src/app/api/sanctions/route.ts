import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  PENAL_GRADES,
  cleanSanctionText,
  dueAtFromDeadlineDays,
  isSanctionMeasureType,
  normalizeSanctionMeasureType,
  parseDeadlineDays,
  penalGradeLabel,
  resolveSanctionMeasure,
  resolveSanctionPenalty,
  sanctionInclude,
  syncSanctionDiscordMessage,
} from '@/lib/sanctions'

/** Obergrenze der Liste — die Seite filtert clientseitig, der Payload bleibt so beschränkt. */
const SANCTION_LIST_LIMIT = 1000

/**
 * Departmentweite Sanktionsliste für die Übersichtsseite.
 *
 * Bewusst ohne Permission-Check: jeder eingeloggte Agent darf offene
 * Sanktionen einsehen. Ausstellen und Verwalten bleiben auf `sanctions:manage`
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
    },
    orderBy: { createdAt: 'desc' },
    take: SANCTION_LIST_LIMIT,
  })

  return success(sanctions)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('sanctions:manage')
    const body = await req.json()

    const agentId = cleanSanctionText(body.agentId)
    const reason = cleanSanctionText(body.reason)
    const penalGrade = cleanSanctionText(body.penalGrade).toUpperCase()
    const measureType = normalizeSanctionMeasureType(body.measureType)
    const deadlineDays = parseDeadlineDays(body.deadlineDays)

    if (!agentId) return error('Agent ist erforderlich')
    if (!reason) return error('Grund ist erforderlich')
    if (!PENAL_GRADES.has(penalGrade)) return error('Penal Grade ist erforderlich')
    if (deadlineDays === undefined) return error('Frist muss zwischen 1 und 365 Tagen liegen')
    const penaltyRule = resolveSanctionPenalty(penalGrade)
    if (!penaltyRule) return error('Penal Grade ist erforderlich')
    if (body.measureType !== undefined && !isSanctionMeasureType(body.measureType)) {
      return error('Maßnahme ist ungültig')
    }
    const selectedMeasure = resolveSanctionMeasure(penaltyRule, measureType)

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { rank: true },
    })
    if (!agent) return error('Agent nicht gefunden')
    if (agent.status === 'TERMINATED') return error('Gekündigte Agents können keine neue Sanktion erhalten')

    const sanction = await prisma.sanction.create({
      data: {
        agentId,
        reason,
        penalGrade,
        measureType: selectedMeasure.measureType,
        fineAmount: selectedMeasure.fineAmount,
        sgRounds: selectedMeasure.sgRounds,
        penalty: penaltyRule.penalty,
        dueAt: dueAtFromDeadlineDays(deadlineDays),
        issuedByUserId: user.id,
        previousRank: agent.rank.name,
        previousBadgeNumber: agent.badgeNumber,
        previousFirstName: agent.firstName,
        previousLastName: agent.lastName,
      },
      include: sanctionInclude,
    })

    await createAuditLog({
      action: 'AGENT_SANCTIONED',
      userId: user.id,
      agentId,
      newValue: penalGradeLabel(penalGrade),
      details: `${agent.firstName} ${agent.lastName}: ${penalGradeLabel(penalGrade)} · ${selectedMeasure.label} · Grade-Folge: ${penaltyRule.penalty} · Frist: ${deadlineDays ? `${deadlineDays} Tage` : '—'} · Grund: ${reason}`,
    })

    await syncSanctionDiscordMessage(sanction)

    return success(sanction, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

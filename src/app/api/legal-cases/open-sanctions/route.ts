import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

/**
 * Offene Sanktionen eines Agents — Basis einer Sanktionsklage.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission('lad:view')
    const agentId = req.nextUrl.searchParams.get('agentId')?.trim()
    if (!agentId) return error('Agent ist erforderlich')

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
    if (!agent) return error('Agent nicht gefunden', 404)

    const sanctions = await prisma.sanction.findMany({
      where: { agentId, status: { in: ['ISSUED', 'EXECUTED'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        penalGrade: true,
        level: true,
        violationCode: true,
        penalty: true,
        suspendedUntil: true,
        status: true,
        createdAt: true,
        issuedBy: { select: { displayName: true } },
      },
    })

    return success(sanctions)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

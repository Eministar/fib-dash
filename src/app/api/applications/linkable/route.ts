import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

/**
 * Schlanke Bewerbungsliste für die Agent-Anlage: nur die Felder, die zum
 * Auswählen und Vorbefüllen nötig sind. Bewusst über `agents:write`
 * abgesichert — wer Agent anlegen darf, darf die zugehörige Bewerbung
 * verknüpfen, auch ohne vollen HR-Zugriff.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission(['agents:write', 'hr:view', 'contracts:manage'])

    // Standard: nur angenommene Bewerbungen, die noch nicht eingestellt sind —
    // genau die, aus denen eine Personalakte entsteht. Abgelehnte und bereits
    // verknüpfte gehören nicht in die Auswahl. `all=true` hebt den Filter auf,
    // damit eine falsche Zuordnung korrigiert werden kann.
    const includeLinked = req.nextUrl.searchParams.get('all') === 'true'

    const applications = await prisma.jobApplication.findMany({
      where: includeLinked ? {} : { agentId: null, status: 'ACCEPTED' },
      select: {
        id: true,
        caseNumber: true,
        applicantDisplayName: true,
        discordId: true,
        discordUsername: true,
        discordGlobalName: true,
        status: true,
        submittedAt: true,
        agentId: true,
        agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true } },
      },
      orderBy: [{ submittedAt: 'desc' }],
      take: 300,
    })

    return success(applications)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

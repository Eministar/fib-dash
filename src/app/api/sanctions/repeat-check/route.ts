import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { assessRepeat } from '@/lib/sanction-repeat'
import { isPenalGrade } from '@/lib/sanctions'

/**
 * Wiederholungsprüfung nach Abschnitt 04 — liefert dem Ausstell-Dialog die
 * gleichartigen Vorverstöße und die daraus empfohlene Sanktionsstufe.
 * Die Entscheidung bleibt bei der ausstellenden Person.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission('sanctions:manage')

    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agentId')
    const grade = searchParams.get('penalGrade') ?? ''
    const violationCode = searchParams.get('violationCode')
    const excludeSanctionId = searchParams.get('excludeSanctionId')

    if (!agentId) return error('Agent ist erforderlich')
    if (!isPenalGrade(grade)) return error('Penal Grade ist erforderlich (1 bis 6)')

    const assessment = await assessRepeat({ agentId, grade, violationCode, excludeSanctionId })
    return success(assessment)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

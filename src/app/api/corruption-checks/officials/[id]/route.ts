import { requireAuth } from '@/lib/auth'
import { success, notFound, error } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { parseOfficialNumber } from '@/lib/corruption-validation'
import { corruptionError, resolveOfficial } from '@/lib/corruption-server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const id = parseOfficialNumber((await params).id)
    if (!id) return error('Ungültige Beamtennummer')
    const resolved = await resolveOfficial(prisma, id)
    const official = resolved ? await prisma.publicOfficial.findUnique({ where: { id: resolved.id }, include: { mergedFrom: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { checks: true } } } }) : null
    return official ? success(official) : notFound('Beamtenakte')
  } catch (cause) { return corruptionError(cause) }
}

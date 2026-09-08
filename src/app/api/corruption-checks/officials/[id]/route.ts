import { requireAuth } from '@/lib/auth'
import { success, notFound, error } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { parseOfficialNumber } from '@/lib/corruption-validation'
import { corruptionError } from '@/lib/corruption-server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const id = parseOfficialNumber((await params).id)
    if (!id) return error('Ungültige Beamtennummer')
    const official = await prisma.publicOfficial.findUnique({ where: { id }, include: { _count: { select: { checks: true } } } })
    return official ? success(official) : notFound('Beamtenakte')
  } catch (cause) { return corruptionError(cause) }
}

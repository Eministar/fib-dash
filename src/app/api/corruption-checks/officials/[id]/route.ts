import { requireAuth } from '@/lib/auth'
import { success, notFound, error } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { officialEditSchema, parseOfficialNumber } from '@/lib/corruption-validation'
import { corruptionError, resolveOfficial } from '@/lib/corruption-server'
import { editOfficial } from '@/lib/corruption-edits'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Context) {
  try {
    await requireAuth()
    const id = parseOfficialNumber((await params).id)
    if (!id) return error('Ungültige Beamtennummer')
    const resolved = await resolveOfficial(prisma, id)
    const official = resolved ? await prisma.publicOfficial.findUnique({ where: { id: resolved.id }, include: { mergedFrom: { select: { id: true, firstName: true, lastName: true } }, revisions: { orderBy: { version: 'desc' } }, _count: { select: { checks: true } } } }) : null
    return official ? success(official) : notFound('Beamtenakte')
  } catch (cause) { return corruptionError(cause) }
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    const user = await requireAuth()
    const id = parseOfficialNumber((await params).id)
    if (!id) return error('Ungültige Beamtennummer')
    const input = officialEditSchema.parse(await req.json())
    return success(await prisma.$transaction(tx => editOfficial(tx, id, input, user), { isolationLevel: 'Serializable' }))
  } catch (cause) { return corruptionError(cause) }
}

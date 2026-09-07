import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export async function GET() {
  try {
    await requirePermission('ranks:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const ranks = await prisma.rank.findMany({ orderBy: { sortOrder: 'asc' } })
  return success(ranks)
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const body = await req.json()

    if (!body.name) return error('Name ist erforderlich')

    const bMin = body.badgeMin != null && body.badgeMin !== '' ? parseInt(String(body.badgeMin), 10) : null
    const bMax = body.badgeMax != null && body.badgeMax !== '' ? parseInt(String(body.badgeMax), 10) : null
    if (bMin != null && bMax != null && bMin > bMax) return error('Dienstnummer-Minimum darf nicht größer als Maximum sein')
    const internalNumber = body.internalNumber == null || body.internalNumber === ''
      ? null
      : Number(body.internalNumber)
    if (internalNumber != null && (!Number.isSafeInteger(internalNumber) || internalNumber < 1)) {
      return error('Die interne Rangnummer muss eine positive ganze Zahl sein')
    }
    if (internalNumber != null) {
      const duplicate = await prisma.rank.findUnique({ where: { internalNumber }, select: { name: true } })
      if (duplicate) return error(`Interne Rangnummer ${internalNumber} wird bereits von „${duplicate.name}“ verwendet`)
    }
    
    const rank = await prisma.rank.create({
      data: {
        name: body.name,
        sortOrder: body.sortOrder ?? 0,
        internalNumber,
        color: body.color ?? '#3B82F6',
        badgeMin: bMin,
        badgeMax: bMax,
      },
    })

    return success(rank, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Name oder interne Rangnummer ist bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

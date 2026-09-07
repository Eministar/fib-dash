import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

export async function GET() {
  try {
    await requirePermission('trainings:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const trainings = await prisma.training.findMany({
    include: { minRank: true },
    orderBy: { sortOrder: 'asc' },
  })
  return success(trainings)
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['trainings:manage'])
    const body = await req.json()

    if (!body.key || !body.label) return error('Key und Label sind erforderlich')
    const minRankId = typeof body.minRankId === 'string' && body.minRankId.trim() ? body.minRankId.trim() : null
    if (minRankId) {
      const rank = await prisma.rank.findUnique({ where: { id: minRankId } })
      if (!rank) return error('Mindestrang nicht gefunden')
    }
    
    const training = await prisma.training.create({
      data: {
        key: body.key,
        label: body.label,
        sortOrder: body.sortOrder ?? 0,
        minRankId,
      },
      include: { minRank: true },
    })

    return success(training, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

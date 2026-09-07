import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['trainings:manage'])
    const { id } = await params
    const body = await req.json()
    const minRankId = body.minRankId === undefined
      ? undefined
      : typeof body.minRankId === 'string' && body.minRankId.trim()
        ? body.minRankId.trim()
        : null
    if (minRankId) {
      const rank = await prisma.rank.findUnique({ where: { id: minRankId } })
      if (!rank) return error('Mindestrang nicht gefunden')
    }

    const training = await prisma.training.update({
      where: { id },
      data: { key: body.key, label: body.label, sortOrder: body.sortOrder, minRankId },
      include: { minRank: true },
    })

    return success(training)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['trainings:manage'])
    const { id } = await params
    await prisma.training.delete({ where: { id } })
    return success({ message: 'Ausbildung gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }
}

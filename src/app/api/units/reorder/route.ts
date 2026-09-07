import { NextRequest } from 'next/server'

import { error, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const body = await req.json()

    const unitIds = Array.isArray(body.unitIds)
      ? body.unitIds.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim()))
      : []

    if (unitIds.length === 0) {
      return error('Keine Unterränge zur Sortierung übergeben')
    }

    await prisma.$transaction(
      unitIds.map((id: string, index: number) =>
        prisma.unit.update({
          where: { id },
          data: {
            sortOrder: (index + 1) * 10,
          },
        }),
      ),
    )

    return success({ message: 'Reihenfolge erfolgreich aktualisiert' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id } = await params
    const body = await req.json()
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content) return error('Kommentar darf nicht leer sein')
    if (content.length > 2_000) return error('Kommentar darf höchstens 2.000 Zeichen enthalten')

    const entry = await prisma.rankChangeListEntry.findUnique({
      where: { id },
      select: { id: true, agentId: true, list: { select: { name: true } } },
    })
    if (!entry) return error('Rangänderung nicht gefunden', 404)

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.rankChangeEntryComment.create({
        data: { entryId: id, authorId: user.id, content },
        include: { author: { select: { id: true, displayName: true, discordId: true } } },
      })
      await tx.auditLog.create({
        data: {
          action: 'RANK_CHANGE_COMMENT_ADDED',
          userId: user.id,
          agentId: entry.agentId,
          details: `Kommentar zur Rangänderung in „${entry.list.name}“`,
        },
      })
      return created
    })

    return success(comment, 201)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id, commentId } = await params
    const comment = await prisma.rankChangeEntryComment.findFirst({
      where: { id: commentId, entryId: id },
      select: { id: true, authorId: true },
    })
    if (!comment) return error('Kommentar nicht gefunden', 404)
    if (comment.authorId !== user.id && !hasPermission(user, 'rank-changes:full-access')) {
      return error('Keine Berechtigung', 403)
    }
    await prisma.rankChangeEntryComment.delete({ where: { id: comment.id } })
    return success({ deleted: true })
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { cleanNoteContent, cleanNotePinned, cleanNoteTitle } from '@/lib/notes'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('notes:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('agentId')

  const where: Record<string, unknown> = {}
  if (agentId) {
    where.agentId = agentId
  }

  const notes = await prisma.note.findMany({
    where,
    include: {
      author: { select: { displayName: true } },
      agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
  })

  return success(notes)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN', 'HR', 'LEADERSHIP'], ['notes:manage'])
    const body = await req.json() as Record<string, unknown>
    const content = cleanNoteContent(body.content)

    if (!content) return error('Inhalt ist erforderlich')

    let title: string | null
    try {
      title = cleanNoteTitle(body.title)
    } catch (e: unknown) {
      return error(e instanceof Error ? e.message : 'Ungültiger Titel')
    }

    const agentId = typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : null

    const note = await prisma.note.create({
      data: {
        agentId,
        authorId: user.id,
        title,
        content,
        pinned: cleanNotePinned(body.pinned),
      },
      include: { author: { select: { displayName: true } } },
    })

    if (agentId) {
      await createAuditLog({
        action: 'NOTE_ADDED',
        userId: user.id,
        agentId,
        details: title || 'Notiz hinzugefügt',
      })
    }

    return success(note, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

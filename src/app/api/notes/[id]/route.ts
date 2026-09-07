import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { INACTIVITY_NOTE_DISMISSED_ACTION, SYSTEM_NOTE_TITLE } from '@/lib/absence-status'
import { cleanNoteContent, cleanNotePinned, cleanNoteTitle } from '@/lib/notes'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const note = await prisma.note.findUnique({ where: { id } })
  if (!note) return notFound('Notiz')
  if (note.authorId !== user.id && !hasPermission(user, 'notes:manage')) return error('Keine Berechtigung', 403)

  const body = await req.json() as Record<string, unknown>
  const content = cleanNoteContent(body.content)
  if (!content) return error('Inhalt ist erforderlich')

  let title: string | null
  try {
    title = cleanNoteTitle(body.title)
  } catch (e: unknown) {
    return error(e instanceof Error ? e.message : 'Ungültiger Titel')
  }

  const data: { title: string | null; content: string; pinned?: boolean } = {
    title,
    content,
  }
  if ('pinned' in body) data.pinned = cleanNotePinned(body.pinned)

  const updated = await prisma.note.update({
    where: { id },
    data,
    include: { author: { select: { displayName: true } } },
  })

  return success(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { id } = await params

  const note = await prisma.note.findUnique({ where: { id } })
  if (!note) return notFound('Notiz')
  if (note.authorId !== user.id && !hasPermission(user, 'notes:manage')) return error('Keine Berechtigung', 403)

  await prisma.$transaction(async (tx) => {
    if (note.agentId && note.title === SYSTEM_NOTE_TITLE) {
      await tx.auditLog.create({
        data: {
          action: INACTIVITY_NOTE_DISMISSED_ACTION,
          userId: user.id,
          agentId: note.agentId,
          details: 'Automatische Fehlzeit-Notiz gelöscht',
        },
      })
    }

    await tx.note.delete({ where: { id } })
  })
  return success({ message: 'Notiz gelöscht' })
}

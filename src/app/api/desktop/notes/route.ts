import { NextRequest } from 'next/server'
import { z } from 'zod'

import { error, success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/** So viele eigene Notizen zeigt die Desktop-App (die neuesten zuerst). */
const LIST_LIMIT = 50

const noteSchema = z.object({
  content: z.string().trim().min(1, 'Die Notiz ist leer').max(5000, 'Die Notiz ist zu lang (max. 5000 Zeichen)'),
  title: z.string().trim().max(191).nullish(),
})

const noteSelect = { id: true, title: true, content: true, createdAt: true, updatedAt: true } as const

/**
 * Persönliche Notizen der Schnellnotiz (Desktop-App): jeder Angemeldete, nur die
 * eigenen. Sie liegen in derselben Tabelle wie die Leitungsnotizen, aber mit
 * `private` – die übrigen Notiz-APIs blenden sie für alle anderen aus.
 * Ändern und Löschen laufen über `/api/notes/[id]` (dort darf der Autor).
 */
export async function GET() {
  try {
    const user = await requireAuth()
    const notes = await prisma.note.findMany({
      where: { authorId: user.id, private: true },
      select: noteSelect,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    })
    return success(notes)
  } catch (cause) {
    return routeError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const parsed = noteSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? 'Ungültige Notiz')
    const note = await prisma.note.create({
      data: { authorId: user.id, private: true, title: parsed.data.title || null, content: parsed.data.content },
      select: noteSelect,
    })
    return success(note, 201)
  } catch (cause) {
    return routeError(cause)
  }
}

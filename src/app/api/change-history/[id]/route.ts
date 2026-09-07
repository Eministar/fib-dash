import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { discardChangeSet } from '@/lib/change-history'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params
    await discardChangeSet(id, user.id)
    return success({ discarded: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    return error(message, 500)
  }
}

import { Prisma } from '@/generated/prisma'
import { ZodError } from 'zod'
import { error, unauthorized, forbidden } from './api-response'
import { CodenameError } from './codenames'

export function codenameRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof CodenameError) return error(cause.message, cause.status)
  if (cause instanceof ZodError) return error(cause.issues.map(issue => issue.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültiges JSON')
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    if (cause.code === 'P2002') return error('Name oder Agent ist bereits vergeben. Bitte neu laden.', 409)
    if (cause.code === 'P2034') return error('Gleichzeitige Änderung. Bitte erneut versuchen.', 409)
    if (cause.code === 'P2025') return error('Deckname oder Agent nicht gefunden', 404)
  }
  console.error('[Codenames]', cause)
  return error('Decknamen konnten nicht verarbeitet werden', 500)
}

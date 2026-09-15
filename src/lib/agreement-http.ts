import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { AgreementError } from './agreement-service'

export function agreementErrorResponse(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof AgreementError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join(' '))
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe')
  console.error('[Agreement]', cause)
  return error('Vertrag konnte nicht verarbeitet werden', 500)
}

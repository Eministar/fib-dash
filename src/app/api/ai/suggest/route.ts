import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { error, forbidden, success, unauthorized } from '@/lib/api-response'
import { AiError, suggestText } from '@/lib/ai/ai-server'
import { MAX_KEYWORDS_LENGTH } from '@/lib/ai/ai-prompts'

const bodySchema = z.object({
  kind: z.enum(['entry', 'investigation']),
  keywords: z.string().trim().min(1, 'Bitte mindestens ein Stichwort angeben.').max(MAX_KEYWORDS_LENGTH),
  investigationId: z.string().trim().max(191).nullable().optional(),
  dossierId: z.string().trim().max(191).nullable().optional(),
}).strict()

/** KI-Vorschlag für einen Chronologie-Eintrag oder eine neue Einsatzakte. */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    const body = bodySchema.parse(await req.json())
    return success(await suggestText(body, user))
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
    if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
    if (cause instanceof AiError) return error(cause.message, cause.status)
    if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join('; '))
    if (cause instanceof SyntaxError) return error('Ungültiges JSON')
    if (cause instanceof Error && cause.message.startsWith('Die KI')) return error(cause.message, 502)
    console.error('[AI] Vorschlag fehlgeschlagen:', cause)
    return error('Der KI-Vorschlag konnte nicht erstellt werden.', 500)
  }
}

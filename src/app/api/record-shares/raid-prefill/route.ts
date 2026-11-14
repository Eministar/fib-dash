import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { shareSelectionSchema } from '@/lib/investigations/record-share-validation'
import { shareError, validateShareItems } from '@/lib/investigations/record-shares'
import { raidPrefill } from '@/lib/investigations/raid-prefill'

/** Vorschlag für den Razzia-Antrag aus den ausgewählten Akten. Speichert nichts. */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    const { items } = z.object({ items: z.array(shareSelectionSchema).max(100) }).strict().parse(await req.json())
    await validateShareItems(prisma, user, items)
    return success(await raidPrefill(user, items))
  } catch (cause) { return shareError(cause) }
}

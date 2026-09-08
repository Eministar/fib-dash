import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { corruptionError } from '@/lib/corruption-server'
import { mergeOfficials } from '@/lib/corruption-edits'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const sourceId = z.coerce.number().int().positive().parse((await params).id)
    const body = z.object({ targetId: z.number().int().positive(), reason: z.string().trim().min(3).max(1000) }).strict().parse(await req.json())
    return success(await prisma.$transaction(tx => mergeOfficials(tx, sourceId, body.targetId, body.reason, user), { isolationLevel: 'Serializable' }))
  } catch (cause) { return corruptionError(cause) }
}

import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { shareKindSchema } from '@/lib/record-share-validation'
import { shareCandidates, shareError } from '@/lib/record-shares'
export async function GET(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    const q = z.object({ kind: shareKindSchema, search: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(Object.fromEntries(new URL(req.url).searchParams))
    return success(await shareCandidates(prisma, user, q.kind, q.search, q.page))
  } catch (cause) { return shareError(cause) }
}

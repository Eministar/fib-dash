import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { shareSchema } from '@/lib/record-share-validation'
import { createShareToken, managedSharesWhere, shareError, sharePath, validateShareItems } from '@/lib/record-shares'

export async function GET() {
  try {
    const user = await requirePermission('investigations:manage')
    return success(await prisma.recordShare.findMany({ where: managedSharesWhere(user), select: { id: true, title: true, enabled: true, expiresAt: true, version: true, createdAt: true, items: { select: { kind: true, recordId: true, title: true, classifiedAtGrant: true } } }, orderBy: { createdAt: 'desc' } }))
  } catch (cause) { return shareError(cause) }
}
export async function POST(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    const input = shareSchema.parse(await req.json())
    const secret = createShareToken()
    const share = await prisma.$transaction(async tx => {
      const items = await validateShareItems(tx, user, input.items)
      const created = await tx.recordShare.create({ data: { title: input.title, enabled: input.enabled, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, tokenHash: secret.tokenHash, createdById: user.id, items: { create: items } } })
      await createAuditLog({ action: 'RECORD_SHARE_CREATED', userId: user.id, details: `Freigabe ${created.id}: ${created.title}; ${items.length} Einträge` }, tx)
      return created
    })
    return success({ id: share.id, path: sharePath(secret.token) }, 201)
  } catch (cause) { return shareError(cause) }
}

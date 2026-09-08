import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { shareUpdateSchema, type ShareSelection } from '@/lib/record-share-validation'
import { createShareToken, managedSharesWhere, ShareError, shareError, sharePath, validateShareItems } from '@/lib/record-shares'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()
    const change = body.action ? z.object({ action: z.enum(['rotate', 'toggle']), version: z.number().int().positive(), enabled: z.boolean().optional() }).strict().parse(body) : null
    const edit = change ? null : shareUpdateSchema.parse(body)
    if (change?.action === 'toggle' && change.enabled === undefined) throw new ShareError('Aktiv-Status fehlt')
    const secret = change?.action === 'rotate' ? createShareToken() : null
    await prisma.$transaction(async tx => {
      const existing = await tx.recordShare.findFirst({ where: { id, ...managedSharesWhere(user) }, include: { items: true } })
      if (!existing) throw new ShareError('Freigabe nicht gefunden', 404)
      const version = change?.version ?? edit!.version
      if (existing.version !== version) throw new ShareError('Freigabe wurde geändert. Bitte neu laden.', 409)
      const items = edit ? await validateShareItems(tx, user, edit.items) : null
      if (change && (change.action === 'rotate' || change.enabled)) await validateShareItems(tx, user, existing.items as ShareSelection[])
      const updated = await tx.recordShare.updateMany({ where: { id, version }, data: {
        version: { increment: 1 },
        ...(edit ? { title: edit.title, enabled: edit.enabled, expiresAt: edit.expiresAt ? new Date(edit.expiresAt) : null } : {}),
        ...(change?.action === 'toggle' ? { enabled: change.enabled } : {}),
        ...(secret ? { tokenHash: secret.tokenHash } : {}),
      } })
      if (!updated.count) throw new ShareError('Freigabe wurde gleichzeitig geändert. Bitte neu laden.', 409)
      if (items) { await tx.recordShareItem.deleteMany({ where: { shareId: id } }); await tx.recordShareItem.createMany({ data: items.map(item => ({ ...item, shareId: id })) }) }
      await createAuditLog({ action: 'RECORD_SHARE_UPDATED', userId: user.id, details: `Freigabe ${id}: ${change?.action ?? 'Auswahl geändert'}` }, tx)
    })
    return success({ id, ...(secret ? { path: sharePath(secret.token) } : {}) })
  } catch (cause) { return shareError(cause) }
}

import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { regeneratePartyToken } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const { id, partyId } = await params
    const token = await regeneratePartyToken(id, partyId)
    const party = await prisma.agreementParty.findUnique({ where: { id: partyId }, select: { name: true, agreement: { select: { title: true } } } })
    await createAuditLog({ action: 'AGREEMENT_TOKEN_REGENERATED', userId: user.id, newValue: party?.agreement.title, details: party?.name })
    return success({ token })
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

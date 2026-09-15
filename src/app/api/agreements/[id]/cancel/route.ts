import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { cancelAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await cancelAgreement((await params).id)
    await createAuditLog({ action: 'AGREEMENT_CANCELLED', userId: user.id, newValue: agreement.title })
    return success(agreement)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

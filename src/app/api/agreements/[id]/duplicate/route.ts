import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { duplicateAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await duplicateAgreement((await params).id, user.id)
    await createAuditLog({ action: 'AGREEMENT_CREATED', userId: user.id, newValue: agreement.title, details: 'Duplikat' })
    return success(agreement, 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

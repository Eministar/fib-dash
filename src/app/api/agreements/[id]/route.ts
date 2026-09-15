import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { agreementInputSchema } from '@/lib/agreements'
import { agreementSelect, deleteAgreement, updateAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:view')
    const agreement = await prisma.agreement.findUnique({ where: { id: (await params).id }, select: agreementSelect })
    return agreement ? success(agreement) : notFound('Vertrag')
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await updateAgreement((await params).id, agreementInputSchema.parse(await req.json()))
    await createAuditLog({ action: 'AGREEMENT_UPDATED', userId: user.id, newValue: agreement.title })
    return success(agreement)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('agreements:manage')
    const { id } = await params
    const existing = await prisma.agreement.findUnique({ where: { id }, select: { title: true } })
    await deleteAgreement(id)
    await createAuditLog({ action: 'AGREEMENT_DELETED', userId: user.id, oldValue: existing?.title })
    return success(null)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

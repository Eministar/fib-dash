import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { agreementInputSchema, isAgreementStatus } from '@/lib/agreements'
import { agreementListSelect, createAgreement } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('agreements:view')
    const search = req.nextUrl.searchParams.get('search')?.trim().slice(0, 100) ?? ''
    const status = req.nextUrl.searchParams.get('status')
    const where: Prisma.AgreementWhereInput = {
      ...(isAgreementStatus(status) ? { status } : {}),
      ...(search ? { OR: [{ title: { contains: search } }, { parties: { some: { name: { contains: search } } } }] } : {}),
    }
    return success(await prisma.agreement.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200, select: agreementListSelect }))
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('agreements:manage')
    const agreement = await createAgreement(agreementInputSchema.parse(await req.json()), user.id)
    await createAuditLog({ action: 'AGREEMENT_CREATED', userId: user.id, newValue: agreement.title, details: agreement.parties.map((p) => p.name).join(', ') })
    return success(agreement, 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  DEFAULT_CONTRACT_TEMPLATE_CLAUSES,
  DEFAULT_CONTRACT_TEMPLATE_CLOSING,
  DEFAULT_CONTRACT_TEMPLATE_CONTENT,
  DEFAULT_CONTRACT_TEMPLATE_FIELDS,
  cleanContractLongText,
  cleanContractText,
  sanitizeContractClauses,
  sanitizeContractFields,
} from '@/lib/contracts'

const templateInclude = {
  createdBy: { select: { id: true, displayName: true } },
  _count: { select: { contracts: true } },
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(['contracts:view', 'contracts:manage'])
    const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

    const templates = await prisma.contractTemplate.findMany({
      where: activeOnly ? { active: true } : {},
      include: templateInclude,
      orderBy: [{ isDefault: 'desc' }, { active: 'desc' }, { updatedAt: 'desc' }],
    })

    return success(templates)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('contracts:manage')
    const body = await req.json()

    const name = cleanContractText(body.name, 120)
    if (!name) return error('Name der Vorlage ist erforderlich')

    const content = cleanContractLongText(body.content) || DEFAULT_CONTRACT_TEMPLATE_CONTENT
    const clauses = sanitizeContractClauses(body.clauses)
    const fields = sanitizeContractFields(body.fields)
    const isDefault = body.isDefault === true

    const template = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.contractTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
      }

      return tx.contractTemplate.create({
        data: {
          name,
          description: cleanContractText(body.description, 400) || null,
          content,
          clauses: (clauses.length > 0 ? clauses : DEFAULT_CONTRACT_TEMPLATE_CLAUSES) as unknown as Prisma.InputJsonValue,
          closing: cleanContractLongText(body.closing, 6000) || DEFAULT_CONTRACT_TEMPLATE_CLOSING,
          fields: (fields.length > 0 ? fields : DEFAULT_CONTRACT_TEMPLATE_FIELDS) as unknown as Prisma.InputJsonValue,
          active: body.active !== false,
          isDefault,
          createdById: user.id,
        },
        include: templateInclude,
      })
    })

    await createAuditLog({
      action: 'CONTRACT_TEMPLATE_CREATED',
      userId: user.id,
      newValue: template.name,
    })

    return success(template, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

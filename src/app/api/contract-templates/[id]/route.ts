import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  cleanContractLongText,
  cleanContractText,
  sanitizeContractClauses,
  sanitizeContractFields,
} from '@/lib/contracts'

const templateInclude = {
  createdBy: { select: { id: true, displayName: true } },
  _count: { select: { contracts: true } },
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(['contracts:view', 'contracts:manage'])
    const { id } = await params

    const template = await prisma.contractTemplate.findUnique({ where: { id }, include: templateInclude })
    if (!template) return notFound('Vertragsvorlage')

    return success(template)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('contracts:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.contractTemplate.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!existing) return notFound('Vertragsvorlage')

    const data: Prisma.ContractTemplateUpdateInput = {}

    if (body.name !== undefined) {
      const name = cleanContractText(body.name, 120)
      if (!name) return error('Name der Vorlage ist erforderlich')
      data.name = name
    }
    if (body.description !== undefined) {
      data.description = cleanContractText(body.description, 400) || null
    }
    if (body.content !== undefined) {
      const content = cleanContractLongText(body.content)
      if (!content) return error('Der Vertragstext darf nicht leer sein')
      data.content = content
    }
    if (body.clauses !== undefined) {
      data.clauses = sanitizeContractClauses(body.clauses) as unknown as Prisma.InputJsonValue
    }
    if (body.closing !== undefined) {
      data.closing = cleanContractLongText(body.closing, 6000) || null
    }
    if (body.fields !== undefined) {
      data.fields = sanitizeContractFields(body.fields) as unknown as Prisma.InputJsonValue
    }
    if (body.active !== undefined) data.active = body.active === true
    if (body.isDefault !== undefined) data.isDefault = body.isDefault === true

    const template = await prisma.$transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.contractTemplate.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        })
      }
      return tx.contractTemplate.update({ where: { id }, data, include: templateInclude })
    })

    await createAuditLog({
      action: 'CONTRACT_TEMPLATE_UPDATED',
      userId: user.id,
      oldValue: existing.name,
      newValue: template.name,
    })

    return success(template)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('contracts:manage')
    const { id } = await params

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { contracts: true } } },
    })
    if (!template) return notFound('Vertragsvorlage')

    // Bereits erstellte Verträge tragen ihren eigenen Snapshot, verlieren aber
    // die Zuordnung. Deshalb wird eine benutzte Vorlage nur deaktiviert.
    if (template._count.contracts > 0) {
      const deactivated = await prisma.contractTemplate.update({
        where: { id },
        data: { active: false, isDefault: false },
        include: templateInclude,
      })
      await createAuditLog({
        action: 'CONTRACT_TEMPLATE_DEACTIVATED',
        userId: user.id,
        oldValue: template.name,
        details: `${template._count.contracts} Vertrag/Verträge nutzen diese Vorlage`,
      })
      return success(deactivated)
    }

    await prisma.contractTemplate.delete({ where: { id } })
    await createAuditLog({
      action: 'CONTRACT_TEMPLATE_DELETED',
      userId: user.id,
      oldValue: template.name,
    })

    return success({ deleted: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

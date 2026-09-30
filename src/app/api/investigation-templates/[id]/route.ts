import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'
import { parseTemplateInput, toTemplateData } from '@/lib/investigation-templates'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:templates')
    const { id } = await params
    const existing = await prisma.investigationTemplate.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return notFound('Aktenvorlage')

    const parsed = parseTemplateInput(await req.json())
    if (!parsed.ok) return error(parsed.error)
    const agentIds = [...new Set([...parsed.value.assigneeIds, ...(parsed.value.leadAgentId ? [parsed.value.leadAgentId] : [])])]
    if (agentIds.length && await prisma.agent.count({ where: { id: { in: agentIds } } }) !== agentIds.length) return error('Mindestens ein zuständiger Agent wurde nicht gefunden', 400)

    const updated = await prisma.investigationTemplate.update({
      where: { id },
      data: parsed.value,
      include: { _count: { select: { investigations: true } } },
    })

    await createAuditLog({
      action: 'INVESTIGATION_TEMPLATE_UPDATED',
      userId: user.id,
      details: `Aktenvorlage „${updated.name}“ geändert${updated.active ? '' : ' (deaktiviert)'}`,
    })
    return success(toTemplateData(updated))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

/**
 * Löscht eine Vorlage. Bestehende Akten behalten ihre Checkliste und offenen
 * Rollen – sie sind beim Anlegen kopiert worden; nur der Verweis entfällt.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:templates')
    const { id } = await params
    const existing = await prisma.investigationTemplate.findUnique({ where: { id }, select: { name: true } })
    if (!existing) return notFound('Aktenvorlage')

    await prisma.investigationTemplate.delete({ where: { id } })
    await createAuditLog({
      action: 'INVESTIGATION_TEMPLATE_DELETED',
      userId: user.id,
      details: `Aktenvorlage „${existing.name}“ gelöscht`,
    })
    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

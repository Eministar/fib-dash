import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { requireAuth, requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'
import { parseTemplateInput, toTemplateData } from '@/lib/investigation-templates'

export const dynamic = 'force-dynamic'

/**
 * Vorlagen für neue Einsatzakten. Wer Akten anlegen darf, sieht die aktiven
 * Vorlagen; wer Vorlagen verwaltet, mit `?all=1` auch deaktivierte.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const canManageTemplates = hasPermission(user, 'investigations:templates')
    if (!canManageTemplates && !hasPermission(user, 'investigations:manage')) return error('Keine Berechtigung', 403)

    const includeInactive = canManageTemplates && req.nextUrl.searchParams.get('all') === '1'
    const rows = await prisma.investigationTemplate.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { investigations: true } } },
    })
    return success(rows.map(toTemplateData))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:templates')
    const parsed = parseTemplateInput(await req.json())
    if (!parsed.ok) return error(parsed.error)
    const agentIds = [...new Set([...parsed.value.assigneeIds, ...(parsed.value.leadAgentId ? [parsed.value.leadAgentId] : [])])]
    if (agentIds.length && await prisma.agent.count({ where: { id: { in: agentIds } } }) !== agentIds.length) return error('Mindestens ein zuständiger Agent wurde nicht gefunden', 400)

    const created = await prisma.investigationTemplate.create({
      data: { ...parsed.value, createdById: user.id },
      include: { _count: { select: { investigations: true } } },
    })

    await createAuditLog({
      action: 'INVESTIGATION_TEMPLATE_CREATED',
      userId: user.id,
      details: `Aktenvorlage „${created.name}“ angelegt`,
    })
    return success(toTemplateData(created), 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

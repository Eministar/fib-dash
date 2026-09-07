import { NextRequest } from 'next/server'

import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { queueAllAgentRoleSync } from '@/lib/discord-integration'
import { automaticPermissionsForRoleNames } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import {
  composeUnitPermissions,
  sanitizeUnitIcon,
  sanitizeUnitModules,
} from '@/lib/unit-modules'

function createGroupKey(name: string) {
  return name
    .trim()
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Macht eine bestehende, eigenständige Unit zur ersten Unterunit einer neuen
 * Gruppe. Die Unit-ID und alle Agent-/Benutzerzuweisungen bleiben erhalten.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const { id } = await params
    const source = await prisma.unit.findUnique({ where: { id } })
    if (!source) return notFound('Unit')
    if (source.groupId) return error('Diese Unit ist bereits einer Unitgruppe zugeordnet')

    const body = await req.json().catch(() => ({})) as { name?: unknown }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : source.name
    const key = createGroupKey(name)
    if (!key) return error('Name ergibt keinen gültigen Gruppen-Key')
    if (await prisma.unitGroup.findUnique({ where: { key }, select: { id: true } })) {
      return error(`Eine Unitgruppe mit dem Key ${key} existiert bereits. Wähle sie im Unit-Editor aus.`)
    }

    const modules = sanitizeUnitModules(source.modules)
    const permissions = Array.from(new Set([
      ...composeUnitPermissions(source.permissions, modules),
      ...automaticPermissionsForRoleNames([key, name]),
    ]))
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.unitGroup.create({
        data: {
          key,
          name,
          description: source.description,
          color: source.color,
          icon: sanitizeUnitIcon(source.icon),
          sortOrder: source.sortOrder,
          active: source.active,
          showInNavigation: source.showInNavigation && Object.keys(modules).length > 0,
          modules,
          permissions,
        },
      })
      const attached = await tx.unit.updateMany({
        where: { id: source.id, groupId: null },
        data: { groupId: created.id, showInNavigation: false, isLeadership: false },
      })
      if (attached.count !== 1) {
        throw new Error('Diese Unit wurde inzwischen einer anderen Unitgruppe zugeordnet')
      }
      return created
    })

    queueAllAgentRoleSync()
    return success({ ...group, icon: sanitizeUnitIcon(group.icon), modules: sanitizeUnitModules(group.modules) }, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Eine Unitgruppe mit diesem Key existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

import { NextRequest } from 'next/server'

import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { queueAllAgentRoleSync } from '@/lib/discord-integration'
import { automaticPermissionsForRoleNames } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import {
  composeUnitPermissions,
  sanitizeUnitIcon,
  sanitizeUnitModules,
} from '@/lib/unit-modules'

function discordRoleId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' && /^\d{17,22}$/.test(value.trim()) ? value.trim() : undefined
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const { id } = await params
    const body = await req.json()
    const existing = await prisma.unitGroup.findUnique({ where: { id } })
    if (!existing) return notFound('Unitgruppe')

    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return error('Name darf nicht leer sein')
      data.name = name
    }
    if ('description' in body) {
      data.description = typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null
    }
    if (typeof body.color === 'string' && body.color) data.color = body.color
    if (typeof body.icon === 'string') data.icon = sanitizeUnitIcon(body.icon)
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
    if (typeof body.active === 'boolean') data.active = body.active

    const modules = 'modules' in body ? sanitizeUnitModules(body.modules) : sanitizeUnitModules(existing.modules)
    if ('modules' in body) data.modules = modules
    if (typeof body.showInNavigation === 'boolean') {
      data.showInNavigation = body.showInNavigation && Object.keys(modules).length > 0
    }
    if (Array.isArray(body.permissions) || 'modules' in body) {
      data.permissions = Array.from(new Set([
        ...composeUnitPermissions(
          Array.isArray(body.permissions) ? body.permissions : existing.permissions,
          modules,
        ),
        ...automaticPermissionsForRoleNames([
          existing.key,
          typeof data.name === 'string' ? data.name : existing.name,
        ]),
      ]))
    }

    if ('memberDiscordRoleId' in body) {
      const roleId = discordRoleId(body.memberDiscordRoleId)
      if (roleId === undefined) return error('Discord-Unitrolle ist ungültig')
      data.memberDiscordRoleId = roleId
    }
    if ('leadershipDiscordRoleId' in body) {
      const roleId = discordRoleId(body.leadershipDiscordRoleId)
      if (roleId === undefined) return error('Discord-Leitungsrolle ist ungültig')
      data.leadershipDiscordRoleId = roleId
    }

    const group = await prisma.unitGroup.update({ where: { id }, data })
    const staleRoleIds = [existing.memberDiscordRoleId, existing.leadershipDiscordRoleId]
      .filter((roleId): roleId is string => Boolean(roleId))
      .filter((roleId) => roleId !== group.memberDiscordRoleId && roleId !== group.leadershipDiscordRoleId)
    queueAllAgentRoleSync({ extraManagedRoleIds: staleRoleIds })

    return success({ ...group, icon: sanitizeUnitIcon(group.icon), modules: sanitizeUnitModules(group.modules) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const { id } = await params
    const group = await prisma.unitGroup.findUnique({ where: { id }, include: { _count: { select: { units: true } } } })
    if (!group) return notFound('Unitgruppe')
    if (group._count.units > 0) {
      return error(`Unitgruppe enthält noch ${group._count.units} Unterunit${group._count.units === 1 ? '' : 's'}. Verschiebe oder lösche sie zuerst.`)
    }

    await prisma.unitGroup.delete({ where: { id } })
    const staleRoleIds = [group.memberDiscordRoleId, group.leadershipDiscordRoleId]
      .filter((roleId): roleId is string => Boolean(roleId))
    queueAllAgentRoleSync({ extraManagedRoleIds: staleRoleIds })
    return success({ message: 'Unitgruppe gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

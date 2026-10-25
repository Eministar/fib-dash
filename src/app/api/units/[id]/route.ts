import { NextRequest } from 'next/server'

import { agentUnitKeys, normalizeUnitKeys } from '@/lib/agents/agent-units'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { queueAllAgentRoleSync } from '@/lib/discord/discord-integration'
import { automaticPermissionsForRoleNames } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import {
  composeUnitPermissions,
  sanitizeUnitIcon,
  sanitizeUnitModules,
} from '@/lib/units/unit-modules'

function discordRoleId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' && /^\d{17,22}$/.test(value.trim()) ? value.trim() : undefined
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const { id } = await params
    const body = await req.json()
    const existing = await prisma.unit.findUnique({ where: { id } })
    if (!existing) return notFound('Unit')

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
    if (typeof body.showInNavigation === 'boolean') data.showInNavigation = body.showInNavigation

    if ('discordRoleId' in body) {
      const roleId = discordRoleId(body.discordRoleId)
      if (roleId === undefined) return error('Discord-Rollen-ID ist ungültig')
      data.discordRoleId = roleId
    }
    if ('groupId' in body) {
      const groupId = typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId.trim() : null
      if (groupId && !await prisma.unitGroup.findUnique({ where: { id: groupId }, select: { id: true } })) {
        return error('Unitgruppe wurde nicht gefunden')
      }
      data.groupId = groupId
      if (!groupId) data.isLeadership = false
      if (groupId) data.showInNavigation = false
    }
    if (existing.groupId && !('groupId' in body)) data.showInNavigation = false
    if (typeof body.isLeadership === 'boolean') {
      const resultingGroupId = 'groupId' in data ? data.groupId : existing.groupId
      data.isLeadership = Boolean(resultingGroupId) && body.isLeadership
    }

    const modules = 'modules' in body ? sanitizeUnitModules(body.modules) : sanitizeUnitModules(existing.modules)
    if ('modules' in body) data.modules = modules
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

    const unit = await prisma.unit.update({ where: { id }, data })
    const syncRelevantChange = unit.groupId !== existing.groupId
      || unit.isLeadership !== existing.isLeadership
      || unit.discordRoleId !== existing.discordRoleId
      || unit.active !== existing.active
    if (syncRelevantChange) {
      queueAllAgentRoleSync({
        extraManagedRoleIds: existing.discordRoleId && existing.discordRoleId !== unit.discordRoleId
          ? [existing.discordRoleId]
          : [],
      })
    }
    return success({ ...unit, icon: sanitizeUnitIcon(unit.icon), modules: sanitizeUnitModules(unit.modules) })
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

    const unit = await prisma.unit.findUnique({ where: { id } })
    if (!unit) return notFound('Unit')

    const referencingAgents = await prisma.agent.findMany({
      where: {
        OR: [
          { unit: unit.key },
          { units: { array_contains: unit.key } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, status: true, unit: true, units: true },
    })
    // Gleiche Zählweise wie die Übersicht: nur aktive (nicht gekündigte) Agents blockieren
    const activeHolders = referencingAgents.filter((agent) => (
      agent.status !== 'TERMINATED' && agentUnitKeys(agent).includes(unit.key)
    ))
    const directUserCount = await prisma.userUnitAssignment.count({ where: { unitId: id } })
    if (activeHolders.length > 0 || directUserCount > 0) {
      const names = activeHolders.slice(0, 5).map((agent) => `${agent.firstName} ${agent.lastName}`).join(', ')
      const more = activeHolders.length > 5 ? `, +${activeHolders.length - 5} weitere` : ''
      const usages = [
        activeHolders.length > 0
          ? `${activeHolders.length} Agent${activeHolders.length === 1 ? '' : 's'} (${names}${more})`
          : '',
        directUserCount > 0 ? `${directUserCount} Benutzer${directUserCount === 1 ? '' : 'n'}` : '',
      ].filter(Boolean).join(' und ')
      return error(`Unit wird noch von ${usages} verwendet. Entferne zuerst die Zuweisungen.`)
    }

    // Gekündigte Agents bzw. veraltete Legacy-Felder referenzieren den Key ggf. noch → bereinigen
    await prisma.$transaction([
      ...referencingAgents.map((agent) => {
        const remaining = normalizeUnitKeys(agent.units).filter((key) => key !== unit.key)
        return prisma.agent.update({
          where: { id: agent.id },
          data: {
            units: remaining,
            unit: agent.unit === unit.key ? (remaining[0] ?? null) : agent.unit,
          },
        })
      }),
      prisma.unit.delete({ where: { id } }),
    ])
    if (unit.discordRoleId) queueAllAgentRoleSync({ extraManagedRoleIds: [unit.discordRoleId] })
    return success({ message: 'Unit gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

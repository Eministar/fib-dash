import { NextRequest } from 'next/server'

import { success, error, unauthorized } from '@/lib/api-response'
import { requireAuth, requirePermission, type CurrentUser } from '@/lib/auth'
import { queueAllAgentRoleSync } from '@/lib/discord-integration'
import { automaticPermissionsForRoleNames, sanitizePermissions } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import {
  composeUnitPermissions,
  sanitizeUnitIcon,
  sanitizeUnitModules,
} from '@/lib/unit-modules'
import { getManagedUnitKeysForUser, hasGlobalAdministratorAccess } from '@/lib/unit-leadership'
import { ensureDefaultNavigationUnits } from '@/lib/unit-navigation'

function createUnitKey(name: string) {
  return name
    .trim()
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function discordRoleId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' && /^\d{17,22}$/.test(value.trim()) ? value.trim() : undefined
}

export async function GET(req: NextRequest) {
  let user: CurrentUser
  try {
    user = await requirePermission('units:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  await ensureDefaultNavigationUnits()
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'
  const includeCounts = req.nextUrl.searchParams.get('includeCounts') === 'true'
  // `active=true&forAssignment=true` wird von Unit-Auswahlfeldern verwendet.
  // Dort dürfen Nicht-Administratoren ausschließlich Units ihrer eigenen
  // markierten Leitungsgruppe sehen. Normale Listen (z. B. Filter im
  // Agent-Verzeichnis) bleiben vollständig sichtbar.
  const assignmentScope = activeOnly && req.nextUrl.searchParams.get('forAssignment') === 'true'
  const restrictAssignmentScope = assignmentScope && !hasGlobalAdministratorAccess(user)
  const managedUnitKeys = restrictAssignmentScope ? await getManagedUnitKeysForUser(user) : []

  const units = await prisma.unit.findMany({
    where: activeOnly
      ? {
          active: true,
          OR: [{ groupId: null }, { group: { active: true } }],
          ...(restrictAssignmentScope ? { key: { in: managedUnitKeys } } : {}),
        }
      : undefined,
    include: {
      _count: { select: { userAssignments: true } },
      group: {
        select: { id: true, key: true, name: true, color: true, icon: true, active: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  const agentCounts = includeCounts
    ? await Promise.all(units.map((unit) => prisma.agent.count({
        where: {
          status: { not: 'TERMINATED' },
          OR: [
            { unit: unit.key },
            { units: { array_contains: unit.key } },
          ],
        },
      })))
    : []

  return success(units.map((unit, index) => {
    const { _count, ...unitData } = unit
    return {
      ...unitData,
      icon: sanitizeUnitIcon(unit.icon),
      modules: sanitizeUnitModules(unit.modules),
      permissions: Array.from(new Set([
        ...sanitizePermissions(unit.permissions),
        ...automaticPermissionsForRoleNames([unit.key, unit.name]),
      ])),
      ...(includeCounts ? {
        assignmentCounts: {
          agents: agentCounts[index] ?? 0,
          directUsers: _count.userAssignments,
        },
      } : {}),
    }
  }))
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['units:manage'])
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return error('Name ist erforderlich')

    const key = createUnitKey(name)
    if (!key) return error('Name ergibt keinen gültigen Unit-Key')
    const modules = sanitizeUnitModules(body.modules)
    const groupId = typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId.trim() : null
    if (groupId && !await prisma.unitGroup.findUnique({ where: { id: groupId }, select: { id: true } })) {
      return error('Unitgruppe wurde nicht gefunden')
    }
    const unitDiscordRoleId = discordRoleId(body.discordRoleId)
    if (unitDiscordRoleId === undefined) return error('Discord-Rollen-ID ist ungültig')

    const unit = await prisma.unit.create({
      data: {
        key,
        name,
        description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
        color: typeof body.color === 'string' && body.color ? body.color : '#d4d4d4',
        icon: sanitizeUnitIcon(body.icon),
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
        active: typeof body.active === 'boolean' ? body.active : true,
        showInNavigation: groupId ? false : (typeof body.showInNavigation === 'boolean' ? body.showInNavigation : false),
        modules,
        groupId,
        isLeadership: Boolean(groupId) && body.isLeadership === true,
        discordRoleId: unitDiscordRoleId,
        permissions: Array.from(new Set([
          ...composeUnitPermissions(body.permissions, modules),
          ...automaticPermissionsForRoleNames([key, name]),
        ])),
      },
    })

    if (groupId || unitDiscordRoleId) queueAllAgentRoleSync()
    return success({ ...unit, icon: sanitizeUnitIcon(unit.icon), modules: sanitizeUnitModules(unit.modules) }, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Unit existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/auth'
import { hasPermission, PERMISSIONS } from '@/lib/permissions'
import { agentUnitKeys } from '@/lib/agent-units'

function normalizedSet(value: string[]) {
  return new Set(value.map((item) => item.trim()).filter(Boolean))
}

function sameSet(a: string[], b: string[]) {
  const setA = normalizedSet(a)
  const setB = normalizedSet(b)
  if (setA.size !== setB.size) return false
  return Array.from(setA).every((item) => setB.has(item))
}

export function hasAgentWriteAccess(user: CurrentUser) {
  if (hasPermission(user, 'agents:write')) return true
  return user.groups.some((group) => ['admin', 'administration', 'hr'].includes(group.name.toLowerCase()))
}

/**
 * Globale Administratoren dürfen Unit-Zuweisungen über alle Gruppen hinweg
 * bearbeiten. Das ist absichtlich enger als `agents:write`: HR- oder andere
 * Fachberechtigungen sollen niemals die Gruppen-Grenze einer Unit-Leitung
 * aushebeln können.
 */
export function hasGlobalAdministratorAccess(user: CurrentUser) {
  const hasAdministratorGroup = user.groups.some((group) =>
    ['admin', 'administration', 'administrator'].includes(group.name.toLowerCase()),
  )
  return hasAdministratorGroup || PERMISSIONS.every((permission) => user.permissions.includes(permission))
}

export async function getManagedUnitKeysForUser(user: CurrentUser): Promise<string[]> {
  if (!hasPermission(user, 'unit-leadership:manage')) return []

  const [linkedAgent, directAssignments] = await Promise.all([
    user.discordId
      ? prisma.agent.findFirst({
          where: {
            discordId: user.discordId,
            status: { not: 'TERMINATED' },
          },
          select: { unit: true, units: true },
        })
      : Promise.resolve(null),
    prisma.userUnitAssignment.findMany({
      where: { userId: user.id, unit: { active: true } },
      select: {
        unit: {
          select: {
            key: true,
            isLeadership: true,
            groupId: true,
            group: { select: { active: true } },
          },
        },
      },
    }),
  ])

  const ownKeys = new Set([
    ...(linkedAgent ? agentUnitKeys(linkedAgent) : []),
    ...directAssignments.map((assignment) => assignment.unit.key),
  ])
  if (ownKeys.size === 0) return []

  const ownUnits = await prisma.unit.findMany({
    where: { key: { in: Array.from(ownKeys) }, active: true },
    select: { key: true, isLeadership: true, groupId: true, group: { select: { active: true } } },
  })
  const leadershipGroupIds = ownUnits
    .filter((unit) => unit.isLeadership && unit.groupId && unit.group?.active)
    .map((unit) => unit.groupId as string)
  const standaloneLeadershipKeys = ownUnits
    .filter((unit) => unit.isLeadership && !unit.groupId && unit.group?.active !== false)
    .map((unit) => unit.key)

  if (leadershipGroupIds.length === 0) return standaloneLeadershipKeys

  const groupUnits = await prisma.unit.findMany({
    where: { groupId: { in: leadershipGroupIds }, active: true },
    select: { key: true },
  })
  return Array.from(new Set([...standaloneLeadershipKeys, ...groupUnits.map((unit) => unit.key)]))
}

export function unitLeadershipChangeError(existingUnits: string[], nextUnits: string[], managedUnits: string[]) {
  const managed = normalizedSet(managedUnits)
  if (managed.size === 0) return 'Nur markierte Unit-Leitungen oder globale Administratoren dürfen Units zuweisen'

  const existingUnmanaged = existingUnits.filter((key) => !managed.has(key))
  const nextUnmanaged = nextUnits.filter((key) => !managed.has(key))
  if (!sameSet(existingUnmanaged, nextUnmanaged)) {
    return 'Unit-Leitung darf nur eigene verknüpfte Units ändern'
  }

  return null
}

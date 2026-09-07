import 'server-only'

import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/permissions'
import {
  composeUnitPermissions,
  sanitizeUnitIcon,
  sanitizeUnitModules,
  unitModuleDefinition,
  type UnitIconKey,
  type UnitModuleKey,
  type UnitModuleSelection,
} from '@/lib/unit-modules'
import type { CurrentUser } from '@/lib/auth'

const BOOTSTRAP_SETTING = 'units.navigationBootstrapped.v2'

const DEFAULT_NAVIGATION_UNITS: {
  key: string
  name: string
  description: string
  color: string
  icon: UnitIconKey
  module: UnitModuleKey
  defaultAccess?: 'view' | 'manage'
  sortOrder: number
}[] = [
  { key: 'ACADEMY', name: 'Academy', description: 'Ausbildung, Recruiting und Nachwuchsarbeit.', color: '#d4d4d4', icon: 'graduation-cap', module: 'academy', sortOrder: 10 },
  { key: 'HR', name: 'HR-Abteilung', description: 'Personalverwaltung und interne Entwicklung.', color: '#7c3aed', icon: 'briefcase', module: 'hr', sortOrder: 20 },
  { key: 'PRESS', name: 'Pressesprecher', description: 'Öffentlichkeitsarbeit und Pressemitteilungen.', color: '#f59e0b', icon: 'newspaper', module: 'press', sortOrder: 30 },
  { key: 'SRU', name: 'S.R.U.', description: 'Taktische Einsatz- und Spezialaufgaben.', color: '#dc2626', icon: 'shield', module: 'sru', sortOrder: 40 },
  { key: 'AIR_SUPPORT', name: 'Air-Support Division', description: 'Luftunterstützung und Flugdienst.', color: '#38bdf8', icon: 'plane', module: 'air_support', sortOrder: 50 },
  { key: 'DETECTIVE', name: 'Detective Unit', description: 'Ermittlungen und Fallbearbeitung.', color: '#a78bfa', icon: 'fingerprint', module: 'detective', sortOrder: 60 },
  { key: 'INTERNAL_AFFAIRS', name: 'Internal Affairs', description: 'Interne Ermittlungen, Dokumentation und Durchsuchungsakten.', color: '#0ea5e9', icon: 'search', module: 'internal_affairs', defaultAccess: 'manage', sortOrder: 70 },
  { key: 'LAD', name: 'Legal Affairs Division', description: 'Rechtsabteilung: Dokumente und Klagen mit geteilter Klageschrift.', color: '#8b5cf6', icon: 'scale', module: 'lad', defaultAccess: 'manage', sortOrder: 80 },
]

let bootstrapPromise: Promise<void> | null = null

async function repairInvalidUnitJsonRows() {
  // Bei der erstmaligen Einführung der JSON-Spalte hat MariaDB auf einzelnen
  // Installationen bestehende Zeilen mit einem leeren String gefüllt. Prisma
  // kann dann nicht einmal mehr selektieren ("Unexpected end of JSON input").
  // Gültige Werte werden von diesen Bedingungen ausdrücklich nicht berührt.
  await prisma.$executeRawUnsafe(`
    UPDATE \`Unit\`
    SET \`modules\` = '{}'
    WHERE \`modules\` IS NULL
       OR TRIM(CAST(\`modules\` AS CHAR)) = ''
       OR JSON_VALID(\`modules\`) = 0
  `)
  await prisma.$executeRawUnsafe(`
    UPDATE \`Unit\`
    SET \`permissions\` = '[]'
    WHERE \`permissions\` IS NULL
       OR TRIM(CAST(\`permissions\` AS CHAR)) = ''
       OR JSON_VALID(\`permissions\`) = 0
  `)
}

async function bootstrapDefaultNavigationUnits() {
  await repairInvalidUnitJsonRows()
  const marker = await prisma.systemSetting.findUnique({ where: { key: BOOTSTRAP_SETTING }, select: { id: true } })
  if (marker) return

  for (const blueprint of DEFAULT_NAVIGATION_UNITS) {
    const existing = await prisma.unit.findUnique({ where: { key: blueprint.key } })
    const selectedModules: UnitModuleSelection = existing
      ? sanitizeUnitModules(existing.modules)
      : {}
    if (!selectedModules[blueprint.module]) selectedModules[blueprint.module] = blueprint.defaultAccess ?? 'view'

    if (existing) {
      await prisma.unit.update({
        where: { id: existing.id },
        data: {
          description: existing.description || blueprint.description,
          icon: existing.icon === 'briefcase' ? blueprint.icon : existing.icon,
          showInNavigation: true,
          modules: selectedModules,
          permissions: composeUnitPermissions(existing.permissions, selectedModules),
        },
      })
    } else {
      await prisma.unit.upsert({
        where: { key: blueprint.key },
        update: {},
        create: {
          key: blueprint.key,
          name: blueprint.name,
          description: blueprint.description,
          color: blueprint.color,
          icon: blueprint.icon,
          sortOrder: blueprint.sortOrder,
          active: true,
          showInNavigation: true,
          modules: selectedModules,
          permissions: composeUnitPermissions([], selectedModules),
        },
      })
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: BOOTSTRAP_SETTING },
    create: { key: BOOTSTRAP_SETTING, value: new Date().toISOString() },
    update: {},
  })
}

export async function ensureDefaultNavigationUnits() {
  bootstrapPromise ??= bootstrapDefaultNavigationUnits().catch((error) => {
    bootstrapPromise = null
    throw error
  })
  await bootstrapPromise
}

export type NavigationModule = {
  key: UnitModuleKey
  label: string
  shortLabel: string
  description: string
  href: string
  icon: UnitIconKey
  access: 'view' | 'manage'
}

export type NavigationUnit = {
  id: string
  key: string
  name: string
  description: string | null
  color: string
  icon: UnitIconKey
  sortOrder: number
  href: string
  modules: NavigationModule[]
}

function userAccessForModule(user: CurrentUser, key: UnitModuleKey) {
  const definition = unitModuleDefinition(key)
  if (!hasPermission(user, definition.viewPermission)) return null
  const canManage = definition.managePermissions.some((permission) => hasPermission(user, permission))
  return canManage ? 'manage' as const : 'view' as const
}

export async function listNavigationUnitsForUser(user: CurrentUser): Promise<NavigationUnit[]> {
  await ensureDefaultNavigationUnits()
  const [groups, standaloneUnits] = await Promise.all([
    prisma.unitGroup.findMany({
      where: { active: true, showInNavigation: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.unit.findMany({
      where: { active: true, showInNavigation: true, groupId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  const navigationFor = (unit: {
    id: string
    key: string
    name: string
    description: string | null
    color: string
    icon: string
    sortOrder: number
    modules: unknown
  }): NavigationUnit | null => {
    const selection = sanitizeUnitModules(unit.modules)
    const modules = (Object.keys(selection) as UnitModuleKey[]).flatMap((key) => {
      const access = userAccessForModule(user, key)
      if (!access) return []
      const definition = unitModuleDefinition(key)
      return [{
        key,
        label: definition.label,
        shortLabel: definition.shortLabel,
        description: definition.description,
        href: definition.href,
        icon: definition.icon,
        access,
      } satisfies NavigationModule]
    })
    if (modules.length === 0) return null

    return {
      id: unit.id,
      key: unit.key,
      name: unit.name,
      description: unit.description,
      color: unit.color,
      icon: sanitizeUnitIcon(unit.icon),
      sortOrder: unit.sortOrder,
      href: modules.length === 1 ? modules[0].href : `/units/${encodeURIComponent(unit.key)}`,
      modules,
    } satisfies NavigationUnit
  }

  const grouped = groups.flatMap((group) => {
    const navigationUnit = navigationFor(group)
    return navigationUnit ? [navigationUnit] : []
  })
  const standalone = standaloneUnits.flatMap((unit) => {
    const navigationUnit = navigationFor(unit)
    return navigationUnit ? [navigationUnit] : []
  })
  return [...grouped, ...standalone].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'))
}

export async function getNavigationUnitForUser(user: CurrentUser, key: string) {
  const units = await listNavigationUnitsForUser(user)
  return units.find((unit) => unit.key === key) ?? null
}

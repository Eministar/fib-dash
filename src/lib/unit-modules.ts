import { sanitizePermissions, type Permission } from '@/lib/permissions'

export const UNIT_MODULE_KEYS = [
  'academy',
  'hr',
  'press',
  'sru',
  'air_support',
  'detective',
  'internal_affairs',
  'lad',
] as const

export type UnitModuleKey = (typeof UNIT_MODULE_KEYS)[number]
export type UnitModuleAccess = 'view' | 'manage'
export type UnitModuleSelection = Partial<Record<UnitModuleKey, UnitModuleAccess>>

export type UnitIconKey =
  | 'briefcase'
  | 'list-checks'
  | 'newspaper'
  | 'shield'
  | 'plane'
  | 'fingerprint'
  | 'graduation-cap'
  | 'radio'
  | 'scale'
  | 'search'
  | 'heart-pulse'
  | 'wrench'
  | 'car'
  | 'siren'
  | 'building'
  | 'users'
  | 'badge'
  | 'star'
  | 'target'
  | 'file-text'

export type UnitModuleDefinition = {
  key: UnitModuleKey
  label: string
  shortLabel: string
  description: string
  href: string
  icon: UnitIconKey
  viewPermission: Permission
  managePermissions: Permission[]
}

export const UNIT_ICON_OPTIONS: { key: UnitIconKey; label: string }[] = [
  { key: 'briefcase', label: 'Abteilung' },
  { key: 'list-checks', label: 'Aufgaben' },
  { key: 'newspaper', label: 'Presse' },
  { key: 'shield', label: 'Schutz' },
  { key: 'plane', label: 'Air Support' },
  { key: 'fingerprint', label: 'Ermittlung' },
  { key: 'graduation-cap', label: 'Ausbildung' },
  { key: 'radio', label: 'Funk' },
  { key: 'scale', label: 'Justiz' },
  { key: 'search', label: 'Suche' },
  { key: 'heart-pulse', label: 'Medical' },
  { key: 'wrench', label: 'Technik' },
  { key: 'car', label: 'Fahrdienst' },
  { key: 'siren', label: 'Einsatz' },
  { key: 'building', label: 'Organisation' },
  { key: 'users', label: 'Team' },
  { key: 'badge', label: 'Dienstmarke' },
  { key: 'star', label: 'Leitung' },
  { key: 'target', label: 'Taktik' },
  { key: 'file-text', label: 'Akten' },
]

export const UNIT_MODULES: UnitModuleDefinition[] = [
  {
    key: 'academy',
    label: 'Academy',
    shortLabel: 'R&T',
    description: 'Ausbildungen, Dokumente, Tests, Aufgaben und Termine.',
    href: '/academy',
    icon: 'graduation-cap',
    viewPermission: 'academy:view',
    managePermissions: ['academy:manage', 'academy-tests:manage'],
  },
  {
    key: 'hr',
    label: 'HR-Abteilung',
    shortLabel: 'HR',
    description: 'Personalakten, Bewerbungen, Verträge und HR-Aufgaben.',
    href: '/hr',
    icon: 'briefcase',
    viewPermission: 'hr:view',
    managePermissions: ['hr:manage', 'hr-tests:manage'],
  },
  {
    key: 'press',
    label: 'Pressesprecher',
    shortLabel: 'Presse',
    description: 'Pressemitteilungen erstellen, bearbeiten und veröffentlichen.',
    href: '/press',
    icon: 'newspaper',
    viewPermission: 'press:view',
    managePermissions: ['press:manage'],
  },
  {
    key: 'sru',
    label: 'S.R.U.',
    shortLabel: 'S.R.U.',
    description: 'Einsatzdokumente, Aufgaben und taktische Termine.',
    href: '/sru',
    icon: 'shield',
    viewPermission: 'sru:view',
    managePermissions: ['sru:manage'],
  },
  {
    key: 'air_support',
    label: 'Air-Support Division',
    shortLabel: 'Air Support',
    description: 'Flugdienst, Einsatzvorbereitung und Air-Support-Termine.',
    href: '/air-support',
    icon: 'plane',
    viewPermission: 'air-support:view',
    managePermissions: ['air-support:manage'],
  },
  {
    key: 'detective',
    label: 'Detective Unit',
    shortLabel: 'Detective',
    description: 'Ermittlungsdokumente, Fallaufgaben und Besprechungen.',
    href: '/detective',
    icon: 'fingerprint',
    viewPermission: 'detective:view',
    managePermissions: ['detective:manage'],
  },
  {
    key: 'internal_affairs',
    label: 'Internal Affairs',
    shortLabel: 'IA',
    description: 'Interne Dokumente und nachvollziehbare Durchsuchungsakten aller Agents.',
    href: '/internal-affairs',
    icon: 'search',
    viewPermission: 'internal-affairs:view',
    managePermissions: ['internal-affairs:manage'],
  },
  {
    key: 'lad',
    label: 'Legal Affairs Division',
    shortLabel: 'LAD',
    description: 'Rechtsabteilung: Dokumente und Klagen mit geteilter Klageschrift.',
    href: '/lad',
    icon: 'scale',
    viewPermission: 'lad:view',
    managePermissions: ['lad:manage'],
  },
]

const moduleKeySet = new Set<string>(UNIT_MODULE_KEYS)
const iconKeySet = new Set<string>(UNIT_ICON_OPTIONS.map((icon) => icon.key))
const moduleByKey = new Map(UNIT_MODULES.map((module) => [module.key, module]))

export function sanitizeUnitIcon(value: unknown): UnitIconKey {
  return typeof value === 'string' && iconKeySet.has(value) ? value as UnitIconKey : 'briefcase'
}

export function sanitizeUnitModules(value: unknown): UnitModuleSelection {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.filter((key): key is UnitModuleKey => typeof key === 'string' && moduleKeySet.has(key))
        .map((key) => [key, 'view' as const]),
    )
  }
  if (!value || typeof value !== 'object') return {}

  const result: UnitModuleSelection = {}
  for (const [key, access] of Object.entries(value)) {
    if (moduleKeySet.has(key) && (access === 'view' || access === 'manage')) {
      result[key as UnitModuleKey] = access
    }
  }
  return result
}

export function unitModuleDefinition(key: UnitModuleKey) {
  return moduleByKey.get(key)!
}

export function moduleControlledPermissions() {
  return new Set<Permission>(UNIT_MODULES.flatMap((module) => [module.viewPermission, ...module.managePermissions]))
}

export function permissionsForUnitModules(modules: UnitModuleSelection): Permission[] {
  const permissions = new Set<Permission>()
  for (const [key, access] of Object.entries(modules) as [UnitModuleKey, UnitModuleAccess][]) {
    const definition = unitModuleDefinition(key)
    permissions.add(definition.viewPermission)
    if (access === 'manage') definition.managePermissions.forEach((permission) => permissions.add(permission))
  }
  return Array.from(permissions)
}

export function composeUnitPermissions(rawPermissions: unknown, modules: UnitModuleSelection): Permission[] {
  const controlled = moduleControlledPermissions()
  return Array.from(new Set([
    ...sanitizePermissions(rawPermissions).filter((permission) => !controlled.has(permission)),
    ...permissionsForUnitModules(modules),
  ]))
}

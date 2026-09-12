export const PERMISSIONS = [
  'leadership-groups:manage',
  'codenames:view',
  'codenames:manage',
  'dashboard:view',
  'calendar:view',
  'calendar:manage',
  'duty-times:view',
  'duty-times:manage',
  'agents:view',
  'agents:write',
  'agent-trainings:manage',
  'agents:promotion-block',
  'agents:delete',
  'terminations:view',
  'terminations:manage',
  'probations:view',
  'probations:manage',
  'sanctions:manage',
  'sanctions:override-authority',
  'sanctions:confirm',
  'rank-changes:view',
  'rank-changes:manage',
  'rank-changes:full-access',
  'rank-change-lists:execute',
  'rank-change-lists:delete',
  'academy:view',
  'academy:manage',
  'academy-tests:manage',
  'press:view',
  'press:manage',
  'hr:view',
  'hr:manage',
  'hr-tests:manage',
  'contracts:view',
  'contracts:manage',
  'sru:view',
  'sru:manage',
  'air-support:view',
  'air-support:manage',
  'detective:view',
  'detective:manage',
'internal-affairs:view',
  'internal-affairs:manage',
  'lad:view',
  'lad:manage',
  'investigations:view',
  'investigations:manage',
  'investigations:classified',
  'investigations:delete',
  'map:view',
  'map:manage',
  'notes:view',
  'notes:manage',
  'uploads:view',
  'uploads:manage',
  'logs:view',
  'exports:view',
  'ranks:view',
  'ranks:manage',
  'trainings:view',
  'trainings:manage',
  'units:view',
  'units:manage',
  'unit-leadership:manage',
  'users:manage',
  'groups:manage',
  'settings:manage',
  'ordnungen:manage',
  'password:change',
  //'rank-change-lists:execute', (removed duplicate)
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<Permission, string> = {
  'leadership-groups:manage': 'Leadership – Ermittlungsgruppen verwalten (vertraulich)',
  'codenames:view': 'Decknamen ansehen',
  'codenames:manage': 'Decknamen verwalten',
  'dashboard:view': 'Dashboard ansehen',
  'calendar:view': 'Kalender ansehen',
  'calendar:manage': 'Kalender verwalten',
  'duty-times:view': 'Dienstzeiten ansehen',
  'duty-times:manage': 'Dienstzeiten verwalten',
  'agents:view': 'Agents ansehen',
  'agents:write': 'Agents bearbeiten',
  'agent-trainings:manage': 'Agent-Ausbildungen setzen',
  'agents:promotion-block': 'Uprank-Sperre verwalten',
  'agents:delete': 'Agents löschen',
  'terminations:view': 'Kündigungen ansehen',
  'terminations:manage': 'Kündigungen verwalten',
  'probations:view': 'Probezeiten ansehen',
  'probations:manage': 'Probezeiten verwalten',
  'sanctions:manage': 'Sanktionen ausstellen',
  'sanctions:override-authority': 'Sanktionen – Zuständigkeit übergehen',
  'sanctions:confirm': 'Sanktionen – Vier-Augen-Bestätigung (PG 5/6)',
  'rank-changes:view': 'Beförderungen/Degradierungen ansehen',
  'rank-changes:manage': 'Rangänderungen verwalten',
  'rank-changes:full-access': 'Rangänderungen – Vollzugriff',
  'rank-change-lists:delete': 'Beförderungs-/Degradierungslisten löschen',
  'rank-change-lists:execute': 'Beförderungen/Degradierungen durchführen',
  'academy:view': 'Academy ansehen',
  'academy:manage': 'Academy verwalten',
  'academy-tests:manage': 'Academy Tests verwalten',
  'press:view': 'Pressesprecherbereich ansehen',
  'press:manage': 'Pressemitteilungen verwalten',
  'hr:view': 'HR ansehen',
  'hr:manage': 'HR verwalten',
  'hr-tests:manage': 'HR Tests verwalten',
  'contracts:view': 'Arbeitsverträge ansehen',
  'contracts:manage': 'Arbeitsverträge verwalten & versenden',
  'sru:view': 'S.R.U. ansehen',
  'sru:manage': 'S.R.U. verwalten',
  'air-support:view': 'Air-Support Division ansehen',
  'air-support:manage': 'Air-Support Division verwalten',
  'detective:view': 'Detective Unit ansehen',
  'detective:manage': 'Detective Unit verwalten',
'internal-affairs:view': 'Internal Affairs ansehen',
  'internal-affairs:manage': 'Internal Affairs verwalten',
  'lad:view': 'Legal Affairs ansehen',
  'lad:manage': 'Legal Affairs verwalten',
  'investigations:view': 'Ermittlungsakten ansehen',
  'investigations:manage': 'Ermittlungsakten verwalten',
  'investigations:classified': 'Verschlusssachen einsehen',
  'investigations:delete': 'Ermittlungsakten löschen',
  'map:view': 'Karte ansehen',
  'map:manage': 'Karte verwalten (Punkte setzen, bearbeiten, verschieben, löschen)',
  'notes:view': 'Notizen ansehen',
  'notes:manage': 'Notizen verwalten',
  'uploads:view': 'Uploads ansehen',
  'uploads:manage': 'Uploads und Upload-Schlüssel verwalten',
  'logs:view': 'Protokoll ansehen',
  'exports:view': 'Exporte verwenden',
  'ranks:view': 'Ränge ansehen',
  'ranks:manage': 'Ränge verwalten',
  'trainings:view': 'Ausbildungen ansehen',
  'trainings:manage': 'Ausbildungen verwalten',
  'units:view': 'Units ansehen',
  'units:manage': 'Units verwalten',
  'unit-leadership:manage': 'Unit-Leitung: Units der eigenen Gruppe zuweisen',
  'users:manage': 'Benutzer verwalten',
  'groups:manage': 'Benutzergruppen verwalten',
  'settings:manage': 'Einstellungen verwalten',
  'ordnungen:manage': 'Ordnungen verwalten',
  'password:change': 'Eigenes Passwort ändern',
}

const PERMISSION_SET = new Set<string>(PERMISSIONS)
const LEGACY_PERMISSION_MAP: Record<string, Permission[]> = {
  'tasks:view': ['academy:view', 'hr:view'],
  'tasks:manage': ['academy:manage', 'hr:manage'],
}

const IMPLIED_PERMISSIONS: Partial<Record<Permission, Permission[]>> = {
  'codenames:manage': ['codenames:view', 'agents:view'],
  'dashboard:view': ['duty-times:view'],
  'calendar:manage': ['calendar:view', 'agents:view'],
  'duty-times:manage': ['duty-times:view', 'agents:view'],
  'agents:write': ['agents:view', 'ranks:view', 'units:view', 'duty-times:manage'],
  'agent-trainings:manage': ['agents:view', 'trainings:view'],
  'agents:promotion-block': ['agents:view'],
  'agents:delete': ['agents:view'],
  'terminations:manage': ['terminations:view', 'agents:view'],
  'probations:manage': ['probations:view', 'agents:view'],
  'sanctions:manage': ['agents:view'],
  'sanctions:override-authority': ['sanctions:manage', 'agents:view'],
  'sanctions:confirm': ['sanctions:manage', 'agents:view'],
  // Backward-compatibility: managing rank changes should include ability to execute rank-change-lists
  'rank-changes:manage': ['rank-changes:view', 'agents:view', 'ranks:view', 'rank-change-lists:execute'],
  // Vollzugriff ist bewusst ein eigenes Recht: fremde Einträge direkt bearbeiten,
  // alle Vorschläge prüfen und Kommentare moderieren. Implikationen stehen hier
  // vollständig, da normalizePermissions nur eine Ebene auflöst.
  'rank-changes:full-access': [
    'rank-changes:view',
    'rank-changes:manage',
    'agents:view',
    'ranks:view',
    'rank-change-lists:execute',
    'rank-change-lists:delete',
  ],
  'rank-change-lists:execute': ['rank-changes:view', 'agents:view', 'ranks:view'],
  'academy:manage': ['academy:view', 'agents:view'],
  'press:manage': ['press:view'],
  // Implikationen werden nur eine Ebene tief aufgelöst (siehe normalizePermissions),
  // deshalb muss `contracts:view` hier explizit mit stehen.
  'hr:manage': ['hr:view', 'agents:view', 'contracts:manage', 'contracts:view'],
  'contracts:view': ['agents:view'],
  'contracts:manage': ['contracts:view', 'agents:view'],
  'sru:manage': ['sru:view', 'agents:view'],
  'air-support:manage': ['air-support:view', 'agents:view'],
  'detective:manage': ['detective:view', 'agents:view'],
'internal-affairs:manage': ['internal-affairs:view', 'agents:view'],
  'lad:manage': ['lad:view', 'agents:view'],
  'investigations:manage': ['investigations:view', 'agents:view'],
  // Verschlusssachen und Löschen setzen Lesezugriff voraus, gewähren aber
  // bewusst kein `investigations:manage` – Einsicht ist nicht Bearbeitung.
  'investigations:classified': ['investigations:view'],
  'investigations:delete': ['investigations:view'],
  'map:manage': ['map:view'],
  'notes:manage': ['notes:view', 'agents:view'],
  'ranks:manage': ['ranks:view'],
  'trainings:manage': ['trainings:view', 'ranks:view'],
  'units:manage': ['units:view'],
  'unit-leadership:manage': ['agents:view', 'units:view'],
  'users:manage': ['groups:manage'],
  'groups:manage': ['users:manage'],
  'settings:manage': ['dashboard:view', 'duty-times:manage'],
}

// Filter to known permissions WITHOUT expanding implied permissions.
// Used at write time so the admin's selection is persisted exactly as chosen
// (otherwise unchecking an implied permission while keeping its parent
// silently re-adds it on save).
export function sanitizePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<Permission>()
  for (const item of value) {
    if (typeof item === 'string' && PERMISSION_SET.has(item)) {
      seen.add(item as Permission)
    } else if (typeof item === 'string' && item in LEGACY_PERMISSION_MAP) {
      for (const mapped of LEGACY_PERMISSION_MAP[item]) seen.add(mapped)
    }
  }
  return Array.from(seen)
}

// Filter to known permissions AND expand implied permissions.
// Used at read/check time so e.g. having `rank-changes:manage` automatically
// grants `agents:view` for runtime permission checks.
export function normalizePermissions(value: unknown): Permission[] {
  const explicit = sanitizePermissions(value)
  const permissions = new Set<Permission>(explicit)
  for (const permission of explicit) {
    for (const implied of IMPLIED_PERMISSIONS[permission] ?? []) {
      permissions.add(implied)
    }
  }
  return Array.from(permissions)
}

export function resolvePermissions(groupPermissions?: unknown): Permission[] {
  return normalizePermissions(groupPermissions)
}


/**
 * Feste Rechte fuer Rollen/Units, deren Zugriff nicht von einer optionalen
 * Checkbox in der Administration abhaengen darf.
 *
 * Aktuell gibt es keine solche Regel mehr: Die einzige vergab dem FJD
 * `reports:view` und ist mit dem Anzeigensystem entfallen. Die Funktion bleibt
 * als Erweiterungspunkt bestehen, damit die Aufrufer unveraendert bleiben.
 */
export function automaticPermissionsForRoleNames(
  _names: Iterable<string | null | undefined>,
): Permission[] {
  return []
}

export function resolveEffectivePermissions(userPermissions?: unknown, groupPermissions?: unknown | unknown[]): Permission[] {
  const groupPermissionList = Array.isArray(groupPermissions) && groupPermissions.some(Array.isArray)
    ? groupPermissions.flatMap((permissions) => sanitizePermissions(permissions))
    : sanitizePermissions(groupPermissions)

  return normalizePermissions([
    ...sanitizePermissions(userPermissions),
    ...groupPermissionList,
  ])
}

export function hasPermission(
  user: { permissions?: string[] | null } | null | undefined,
  permission: Permission,
) {
  if (!user) return false
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

export function hasAnyPermission(
  user: { permissions?: string[] | null } | null | undefined,
  permissions: Permission[],
) {
  return permissions.some((permission) => hasPermission(user, permission))
}

/**
 * Liefert die Schnittmenge zweier Permission-Listen.
 *
 * Wird für die Discord-ID-Impersonation genutzt: Wenn ein API-Token mit
 * zusätzlichem `X-Discord-Id` Header aufgerufen wird, sind die effektiven
 * Rechte = (Token-Scopes) ∩ (User-Permissions). So kann der Token nie
 * Rechte ausüben, die der Inhaber (oder der impersonierte User) nicht hat.
 */
export function intersectPermissions(
  a: readonly Permission[],
  b: readonly Permission[],
): Permission[] {
  const setB = new Set<Permission>(b)
  return a.filter((p) => setB.has(p))
}

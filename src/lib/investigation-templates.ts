/**
 * Aktenvorlagen: Typen, Validierung und die Umwandlung einer Vorlage in die
 * Checkliste bzw. offenen Rollen einer neuen Akte. Bewusst ohne Server-
 * Importe – Formulare und Route Handler benutzen dieselben Regeln.
 */
import {
  INVESTIGATION_PERSON_ROLE_LABELS,
  type InvestigationPersonRoleKey,
  type InvestigationPriorityKey,
  isInvestigationPersonRole,
  isInvestigationPriority,
} from '@/lib/investigations'

export const TEMPLATE_LIMITS = {
  name: 100,
  titlePrefix: 80,
  description: 2_000,
  summary: 20_000,
  checklistItems: 40,
  checklistLabel: 200,
  roles: 20,
  roleLabel: 100,
  assignees: 20,
} as const

export type TemplateRole = { role: InvestigationPersonRoleKey; label: string }

export type InvestigationTemplateData = {
  id: string
  name: string
  description: string | null
  titlePrefix: string | null
  summary: string | null
  priority: InvestigationPriorityKey
  classified: boolean
  checklist: string[]
  roles: TemplateRole[]
  leadAgentId: string | null
  assigneeIds: string[]
  active: boolean
  sortOrder: number
  updatedAt: string
  /** Wie viele Akten aus dieser Vorlage angelegt wurden. */
  usageCount?: number
}

/** Ein Arbeitsschritt in einer konkreten Akte. */
export type ChecklistItem = {
  id: string
  label: string
  done: boolean
  doneAt: string | null
  doneBy: string | null
}

/** Ein noch offener Beteiligter aus der Vorlage. */
export type OpenRole = { id: string; role: InvestigationPersonRoleKey; label: string }

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function sanitizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const label = cleanText(entry, TEMPLATE_LIMITS.checklistLabel)
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    result.push(label)
    if (result.length >= TEMPLATE_LIMITS.checklistItems) break
  }
  return result
}

export function sanitizeRoles(value: unknown): TemplateRole[] {
  if (!Array.isArray(value)) return []
  const result: TemplateRole[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { role, label } = entry as { role?: unknown; label?: unknown }
    if (!isInvestigationPersonRole(role)) continue
    result.push({ role, label: cleanText(label, TEMPLATE_LIMITS.roleLabel) || INVESTIGATION_PERSON_ROLE_LABELS[role] })
    if (result.length >= TEMPLATE_LIMITS.roles) break
  }
  return result
}

export function sanitizeIdList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))).slice(0, max)
}

export type TemplateInput = Omit<InvestigationTemplateData, 'id' | 'updatedAt' | 'usageCount'>

/** Prüft und bereinigt die Eingabe des Vorlagen-Editors. */
export function parseTemplateInput(body: unknown): { ok: true; value: TemplateInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Ungültige Vorlage' }
  const input = (body ?? {}) as Record<string, unknown>
  if (Array.isArray(input.checklist) && input.checklist.filter(item => typeof item === 'string' && item.trim()).length > TEMPLATE_LIMITS.checklistItems) return { ok: false, error: `Höchstens ${TEMPLATE_LIMITS.checklistItems} Arbeitsschritte pro Vorlage` }
  if (Array.isArray(input.checklist) && input.checklist.some(item => typeof item !== 'string' || item.trim().length > TEMPLATE_LIMITS.checklistLabel)) return { ok: false, error: `Arbeitsschritte müssen Texte mit höchstens ${TEMPLATE_LIMITS.checklistLabel} Zeichen sein` }
  if (Array.isArray(input.roles) && input.roles.length > TEMPLATE_LIMITS.roles) return { ok: false, error: `Höchstens ${TEMPLATE_LIMITS.roles} Rollen pro Vorlage` }
  if (Array.isArray(input.assigneeIds) && input.assigneeIds.length > TEMPLATE_LIMITS.assignees) return { ok: false, error: `Höchstens ${TEMPLATE_LIMITS.assignees} Ermittler pro Vorlage` }
  const name = cleanText(input.name, TEMPLATE_LIMITS.name + 1)
  if (!name) return { ok: false, error: 'Name der Vorlage ist erforderlich' }
  if (name.length > TEMPLATE_LIMITS.name) return { ok: false, error: `Name ist zu lang (max. ${TEMPLATE_LIMITS.name} Zeichen)` }
  const priority = input.priority ?? 'NORMAL'
  if (!isInvestigationPriority(priority)) return { ok: false, error: 'Unbekannte Priorität' }
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.max(0, Math.min(9999, Math.round(Number(input.sortOrder)))) : 0

  return {
    ok: true,
    value: {
      name,
      description: cleanText(input.description, TEMPLATE_LIMITS.description) || null,
      titlePrefix: cleanText(input.titlePrefix, TEMPLATE_LIMITS.titlePrefix) || null,
      summary: typeof input.summary === 'string' ? input.summary.slice(0, TEMPLATE_LIMITS.summary).trim() || null : null,
      priority,
      classified: input.classified === true,
      checklist: sanitizeChecklist(input.checklist),
      roles: sanitizeRoles(input.roles),
      leadAgentId: cleanText(input.leadAgentId, 64) || null,
      assigneeIds: sanitizeIdList(input.assigneeIds, TEMPLATE_LIMITS.assignees),
      active: input.active !== false,
      sortOrder,
    },
  }
}

/** Datenbank-Zeile → Client-Form (JSON-Felder defensiv lesen). */
export function toTemplateData(row: {
  id: string
  name: string
  description: string | null
  titlePrefix: string | null
  summary: string | null
  priority: string
  classified: boolean
  checklist: unknown
  roles: unknown
  leadAgentId: string | null
  assigneeIds: unknown
  active: boolean
  sortOrder: number
  updatedAt: Date
  _count?: { investigations: number }
}): InvestigationTemplateData {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    titlePrefix: row.titlePrefix,
    summary: row.summary,
    priority: isInvestigationPriority(row.priority) ? row.priority : 'NORMAL',
    classified: row.classified,
    checklist: sanitizeChecklist(row.checklist),
    roles: sanitizeRoles(row.roles),
    leadAgentId: row.leadAgentId,
    assigneeIds: sanitizeIdList(row.assigneeIds, TEMPLATE_LIMITS.assignees),
    active: row.active,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
    usageCount: row._count?.investigations,
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Kopie der Vorlagen-Checkliste für eine neue Akte – alle Punkte offen. */
export function checklistFromTemplate(labels: string[]): ChecklistItem[] {
  return sanitizeChecklist(labels).map((label) => ({ id: randomId(), label, done: false, doneAt: null, doneBy: null }))
}

export function openRolesFromTemplate(roles: TemplateRole[]): OpenRole[] {
  return sanitizeRoles(roles).map((role) => ({ id: randomId(), ...role }))
}

/** Liest die gespeicherte Checkliste einer Akte defensiv. */
export function readChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Partial<ChecklistItem>
    if (typeof item.id !== 'string' || typeof item.label !== 'string') return []
    return [{
      id: item.id,
      label: item.label,
      done: item.done === true,
      doneAt: typeof item.doneAt === 'string' ? item.doneAt : null,
      doneBy: typeof item.doneBy === 'string' ? item.doneBy : null,
    }]
  })
}

export function readOpenRoles(value: unknown): OpenRole[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Partial<OpenRole>
    if (typeof item.id !== 'string' || !isInvestigationPersonRole(item.role)) return []
    return [{ id: item.id, role: item.role, label: typeof item.label === 'string' ? item.label : INVESTIGATION_PERSON_ROLE_LABELS[item.role] }]
  })
}

/** Neuer Checklisten-Punkt direkt in der Akte. */
export function newChecklistItem(label: string): ChecklistItem | null {
  const clean = cleanText(label, TEMPLATE_LIMITS.checklistLabel)
  return clean ? { id: randomId(), label: clean, done: false, doneAt: null, doneBy: null } : null
}

/** Titel aus Präfix und eigener Eingabe, ohne das Präfix doppelt zu setzen. */
export function composeTitle(prefix: string | null | undefined, title: string): string {
  const cleanPrefix = prefix?.trim() ?? ''
  const cleanTitle = title.trim()
  if (!cleanPrefix) return cleanTitle
  if (cleanTitle.toLowerCase().startsWith(cleanPrefix.toLowerCase())) return cleanTitle
  return `${cleanPrefix} ${cleanTitle}`.replace(/\s+/g, ' ').trim()
}

export type TemplatePrefill = Pick<TemplateInput, 'classified' | 'assigneeIds'> & { title: string; summary: string; leadAgentId: string; priority: string }

export function templatePrefill(template: InvestigationTemplateData | null, agentIds?: string[]): TemplatePrefill {
  const exists = (id: string) => !agentIds || agentIds.includes(id)
  return {
    title: template?.titlePrefix ? `${template.titlePrefix.trim()} ` : '',
    summary: template?.summary ?? '',
    priority: template?.priority ?? 'NORMAL',
    classified: template?.classified ?? true,
    leadAgentId: template?.leadAgentId && exists(template.leadAgentId) ? template.leadAgentId : '',
    assigneeIds: template?.assigneeIds.filter(exists) ?? [],
  }
}

/** Nur unveränderte Vorgaben ersetzen; eigene Eingaben bleiben beim Wechsel erhalten. */
export function mergeTemplatePrefill<T extends TemplatePrefill>(form: T, previous: TemplatePrefill, next: TemplatePrefill): T {
  return {
    ...form,
    title: !form.title.trim() || form.title === previous.title ? next.title : form.title,
    summary: !form.summary.trim() || form.summary === previous.summary ? next.summary : form.summary,
    priority: form.priority === previous.priority ? next.priority : form.priority,
    classified: form.classified === previous.classified ? next.classified : form.classified,
    leadAgentId: form.leadAgentId === previous.leadAgentId ? next.leadAgentId : form.leadAgentId,
    assigneeIds: form.assigneeIds.length === previous.assigneeIds.length && form.assigneeIds.every(id => previous.assigneeIds.includes(id)) ? next.assigneeIds : form.assigneeIds,
  }
}

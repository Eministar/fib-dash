import { api } from '../api'
import { formatDateTime } from '../format'
import type { Field, Option } from '../ui/form-dialog'
import { agentName, personName, type Agent, type CorruptionCheckRef, type ListItem, type Person, type Vehicle } from './model'

// Auswahllisten für Dialoge. Einmal geladen, bis zur nächsten Änderung gemerkt.

const cache = new Map<string, Promise<unknown>>()

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, load().catch((error) => { cache.delete(key); throw error }))
  return cache.get(key) as Promise<T>
}

export function invalidate(...keys: string[]) {
  for (const key of keys) cache.delete(key)
}

export const lookups = {
  agents: () => cached('agents', () => api.get<Agent[]>('/api/investigations/agents')),
  persons: () => cached('persons', () => api.get<Person[]>('/api/persons')),
  vehicles: () => cached('vehicles', () => api.get<Vehicle[]>('/api/vehicles')),
  cases: () => cached('cases', () => api.get<ListItem[]>('/api/investigations?status=ALL')),
  /** Die letzten 100 Korruptionskontrollen – Auswahl für den Anlass einer Akte. */
  corruptionChecks: () =>
    cached('corruptionChecks', async () => {
      const pages = await Promise.all([1, 2, 3, 4].map((page) => api.get<{ items: CorruptionCheckRef[] }>(`/api/corruption-checks?page=${page}`).catch(() => ({ items: [] }))))
      return pages.flatMap((page) => page.items)
    }),
  templates: () =>
    cached('templates', () => api.get<{ id: string; name: string; description: string | null }[]>('/api/investigation-templates').catch(() => [])),
}

export async function agentOptions(): Promise<Option[]> {
  return (await lookups.agents()).map((a) => ({ value: a.id, label: agentName(a) }))
}

export async function personOptions(): Promise<Option[]> {
  return (await lookups.persons()).map((p) => ({ value: p.id, label: `${personName(p)} · ${p.personNumber}` }))
}

export async function vehicleOptions(): Promise<Option[]> {
  return (await lookups.vehicles()).map((v) => ({
    value: v.id,
    label: [v.plate ?? 'ohne Kennzeichen', v.model, v.color].filter(Boolean).join(' · ') + ` · ${v.vehicleNumber}`,
  }))
}

export function corruptionCheckLabel(check: CorruptionCheckRef) {
  return `${check.official.firstName} ${check.official.lastName} (${check.official.agency})`
}

/** Optionen für den Anlass; die aktuelle Kontrolle bleibt wählbar, auch wenn sie älter ist. */
export async function corruptionCheckOptions(current?: CorruptionCheckRef | null): Promise<Option[]> {
  const checks = await lookups.corruptionChecks()
  const list = current && !checks.some((c) => c.id === current.id) ? [current, ...checks] : checks
  return [
    { value: '', label: 'Kein besonderer Anlass' },
    ...list.map((c) => ({
      value: c.id,
      label: `${corruptionCheckLabel(c)} · ${formatDateTime(new Date(c.conductedAt))} · ${c.result === 'FINDINGS' ? 'Befund' : 'ohne Befund'}`,
    })),
  ]
}

export function corruptionField(options: Option[], value = ''): Field {
  return {
    name: 'corruptionCheckId',
    value,
    label: 'Anlass: Korruptionskontrolle',
    type: 'combobox',
    options,
    span: 2,
    hint: 'Optional – die Kontrolle, aus der diese Ermittlung hervorgeht.',
  }
}

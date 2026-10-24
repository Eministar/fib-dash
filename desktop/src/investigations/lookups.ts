import { api } from '../api'
import type { Option } from '../ui/form-dialog'
import { agentName, personName, type Agent, type ListItem, type Person, type Vehicle } from './model'

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

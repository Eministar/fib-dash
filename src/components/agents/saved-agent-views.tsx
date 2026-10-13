'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { agentSavedViewsSchema, readAgentViews, sameAgentFilters, emptyAgentFilters, type AgentSavedView, type AgentViewFilters } from '@/lib/agent-saved-views'

const eventName = 'agent-views-changed'
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(eventName, callback)
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(eventName, callback) }
}

export function SavedAgentViews({ userId, filters, onApply }: { userId: string; filters: AgentViewFilters; onApply: (filters: AgentViewFilters) => void }) {
  const key = `fib:agent-views:${userId}`
  const raw = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) } catch { return null }
  }, () => null)
  const views = readAgentViews(raw)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const active = views.find(view => sameAgentFilters(view.filters, filters))
  function persist(next: AgentSavedView[]) {
    if (!agentSavedViewsSchema.safeParse(next).success) { setError('Die Ansicht enthält ungültige Filter oder eine zu lange Suche (maximal 200 Zeichen).'); return false }
    try {
      localStorage.setItem(key, JSON.stringify(next))
      window.dispatchEvent(new Event(eventName))
      setError('')
      return true
    } catch { setError('Die Ansicht konnte nicht gespeichert werden. Bitte Browser-Speicher prüfen.'); return false }
  }
  return <div className="mb-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="agent-saved-view">Gespeicherte Ansicht</label>
      <select id="agent-saved-view" className="h-8 max-w-full rounded border border-[#38383a] px-2 text-xs" value={active?.id ?? ''} onChange={event => onApply(views.find(view => view.id === event.target.value)?.filters ?? emptyAgentFilters)}>
        <option value="">{sameAgentFilters(filters, emptyAgentFilters) ? 'Alle Agents' : 'Aktuelle Filter'}</option>
        {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      <Button size="sm" variant="ghost" disabled={views.length >= 20} onClick={() => { setName(''); setError(''); setOpen(true) }}>Ansicht speichern</Button>
      {active && <Button size="sm" variant="ghost" onClick={() => persist(views.filter(view => view.id !== active.id))}>Ansicht löschen</Button>}
      {!sameAgentFilters(filters, emptyAgentFilters) && <Button size="sm" variant="ghost" onClick={() => onApply(emptyAgentFilters)}>Filter zurücksetzen</Button>}
    </div>
    {error && !open && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {open && <Modal open onClose={() => setOpen(false)} title="Ansicht speichern">
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const label = name.trim()
        if (!label) return
        const existing = views.find(view => sameAgentFilters(view.filters, filters))
        if (existing) { setError(`Diese Filter sind bereits als „${existing.name}“ gespeichert.`); return }
        if (views.some(view => view.name.toLocaleLowerCase('de') === label.toLocaleLowerCase('de'))) { setError('Eine Ansicht mit diesem Namen existiert bereits.'); return }
        if (views.length >= 20) { setError('Maximal 20 Ansichten möglich.'); return }
        if (persist([...views, { id: crypto.randomUUID(), name: label, filters }])) setOpen(false)
      }}>
        <Input autoFocus required label="Name" maxLength={50} value={name} onChange={event => setName(event.target.value)} placeholder="Zum Beispiel Agents in Ausbildung" />
        <p className="text-xs text-[#98989d]">Speichert Suche, Status, Rang, Unit und Markierung für dein Konto in diesem Browser.</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button><Button type="submit">Speichern</Button></div>
      </form>
    </Modal>}
  </div>
}

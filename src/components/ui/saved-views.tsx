'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { SAVED_VIEWS_LIMIT, type SavedView } from '@/lib/core/saved-views'

const eventName = 'saved-views-changed'
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(eventName, callback)
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(eventName, callback) }
}

/**
 * Auswahl, Speichern und Löschen gespeicherter Filteransichten einer Liste.
 * Abgelegt im Browser je Konto (`storageKey`), nicht auf dem Server.
 */
export function SavedViews<F>({
  storageKey,
  filters,
  defaults,
  onApply,
  read,
  same,
  validate,
  defaultLabel,
  placeholder,
  hint,
}: {
  storageKey: string
  filters: F
  /** Voreinstellung der Liste; „Filter zurücksetzen“ führt hierhin. */
  defaults: F
  onApply: (filters: F) => void
  read: (raw: string | null) => SavedView<F>[]
  same: (a: F, b: F) => boolean
  validate: (views: SavedView<F>[]) => boolean
  defaultLabel: string
  placeholder: string
  hint: string
}) {
  const raw = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(storageKey) } catch { return null }
  }, () => null)
  const views = read(raw)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const active = views.find(view => same(view.filters, filters))
  const selectId = `${storageKey}:select`

  function persist(next: SavedView<F>[]) {
    if (!validate(next)) { setError('Die Ansicht enthält ungültige Filter oder eine zu lange Suche (maximal 200 Zeichen).'); return false }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      window.dispatchEvent(new Event(eventName))
      setError('')
      return true
    } catch { setError('Die Ansicht konnte nicht gespeichert werden. Bitte Browser-Speicher prüfen.'); return false }
  }

  return <div className="mb-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={selectId}>Gespeicherte Ansicht</label>
      <select id={selectId} className="h-8 max-w-full rounded border border-[#38383a] px-2 text-xs" value={active?.id ?? ''} onChange={event => onApply(views.find(view => view.id === event.target.value)?.filters ?? defaults)}>
        <option value="">{same(filters, defaults) ? defaultLabel : 'Aktuelle Filter'}</option>
        {views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      <Button size="sm" variant="ghost" disabled={views.length >= SAVED_VIEWS_LIMIT} onClick={() => { setName(''); setError(''); setOpen(true) }}>Ansicht speichern</Button>
      {active && <Button size="sm" variant="ghost" onClick={() => persist(views.filter(view => view.id !== active.id))}>Ansicht löschen</Button>}
      {!same(filters, defaults) && <Button size="sm" variant="ghost" onClick={() => onApply(defaults)}>Filter zurücksetzen</Button>}
    </div>
    {error && !open && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {open && <Modal open onClose={() => setOpen(false)} title="Ansicht speichern">
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const label = name.trim()
        if (!label) return
        const existing = views.find(view => same(view.filters, filters))
        if (existing) { setError(`Diese Filter sind bereits als „${existing.name}“ gespeichert.`); return }
        if (views.some(view => view.name.toLocaleLowerCase('de') === label.toLocaleLowerCase('de'))) { setError('Eine Ansicht mit diesem Namen existiert bereits.'); return }
        if (views.length >= SAVED_VIEWS_LIMIT) { setError(`Maximal ${SAVED_VIEWS_LIMIT} Ansichten möglich.`); return }
        if (persist([...views, { id: crypto.randomUUID(), name: label, filters }])) setOpen(false)
      }}>
        <Input autoFocus required label="Name" maxLength={50} value={name} onChange={event => setName(event.target.value)} placeholder={placeholder} />
        <p className="text-xs text-[#98989d]">{hint}</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button><Button type="submit">Speichern</Button></div>
      </form>
    </Modal>}
  </div>
}

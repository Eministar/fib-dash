'use client'

import { useMemo, useState } from 'react'
import { Network, Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { labelOptions } from '@/components/investigations/investigation-badges'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { PERSON_LINK_TYPE_LABELS } from '@/lib/investigations'
import type { Person, PersonLink } from '@/components/investigations/types'

/// Eine Zeile des Beziehungsnetzes. `outgoing` unterscheidet "X ist Arbeitgeber
/// von dieser Person" von der Gegenrichtung.
type Row = { id: string; peer: Person; type: PersonLink['type']; note: string | null; outgoing: boolean }

interface PersonLinksProps {
  personId: string
  linksFrom: (PersonLink & { toPerson: Person })[]
  linksTo: (PersonLink & { fromPerson: Person })[]
  persons: Person[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

export function PersonLinks({
  personId,
  linksFrom,
  linksTo,
  persons,
  canManage,
  onChanged,
}: PersonLinksProps) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [open, setOpen] = useState(false)
  const [toPersonId, setToPersonId] = useState('')
  const [type, setType] = useState('ASSOCIATE')
  const [note, setNote] = useState('')

  const rows = useMemo<Row[]>(
    () => [
      ...linksFrom.map((link) => ({
        id: link.id,
        peer: link.toPerson,
        type: link.type,
        note: link.note,
        outgoing: true,
      })),
      ...linksTo.map((link) => ({
        id: link.id,
        peer: link.fromPerson,
        type: link.type,
        note: link.note,
        outgoing: false,
      })),
    ],
    [linksFrom, linksTo],
  )

  const options = useMemo(() => {
    const taken = new Set(rows.map((row) => row.peer.id))
    taken.add(personId)
    return [
      { value: '', label: 'Person wählen' },
      ...persons
        .filter((person) => !taken.has(person.id))
        .map((person) => ({
          value: person.id,
          label: `${person.lastName}, ${person.firstName} (${person.personNumber})`,
        })),
    ]
  }, [persons, rows, personId])

  const handleAdd = async () => {
    const ok = await mutate(`/api/persons/${personId}/links`, {
      body: { toPersonId, type, note },
      successTitle: 'Verbindung angelegt',
      errorTitle: 'Verbinden fehlgeschlagen',
    })
    if (ok) {
      setToPersonId('')
      setNote('')
      setOpen(false)
    }
  }

  const handleRemove = (row: Row) =>
    mutate(`/api/persons/links/${row.id}`, {
      method: 'DELETE',
      successTitle: 'Verbindung entfernt',
      errorTitle: 'Entfernen fehlgeschlagen',
    })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-medium text-[#a6a6a6]">Umfeld ({rows.length})</p>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Verbinden
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[#6a6a6a]">Keine Verbindungen erfasst.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-[9px] border border-[#232323] bg-[#111111] px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Network className="h-3.5 w-3.5 shrink-0 text-[#6a6a6a]" />
                  <span className="text-[13px] text-white">
                    {row.peer.firstName} {row.peer.lastName}
                  </span>
                  <Badge>{PERSON_LINK_TYPE_LABELS[row.type]}</Badge>
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-[#5a5a5a]">
                    {row.outgoing ? 'ausgehend' : 'eingehend'}
                  </span>
                </div>
                {row.note && <p className="mt-0.5 text-[12px] text-[#a6a6a6]">{row.note}</p>}
              </div>

              {/* Nur die eigene Richtung ist hier loesbar – die Gegenrichtung
                  gehoert zur anderen Personenakte. */}
              {canManage && row.outgoing && (
                <button
                  type="button"
                  onClick={() => void handleRemove(row)}
                  className="shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                  aria-label="Verbindung entfernen"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Person verbinden"
        description="Die Verbindung erscheint in beiden Personenakten."
        size="lg"
      >
        <div className="space-y-4">
          <Select label="Person" options={options} value={toPersonId} onValueChange={setToPersonId} />
          <Select
            label="Art der Verbindung"
            options={labelOptions(PERSON_LINK_TYPE_LABELS)}
            value={type}
            onValueChange={setType}
          />
          <Textarea
            label="Notiz"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAdd} loading={saving} disabled={!toPersonId}>
              Verbinden
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

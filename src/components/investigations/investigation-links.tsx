'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, Link2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useFetch } from '@/hooks/use-fetch'
import { PriorityBadge, StatusBadge } from '@/components/investigations/investigation-badges'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import type {
  InvestigationCrossLink,
  InvestigationListItem,
  LinkedCase,
} from '@/components/investigations/types'

interface InvestigationLinksProps {
  investigationId: string
  linksFrom: InvestigationCrossLink[]
  linksTo: InvestigationCrossLink[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

/// Eine Zeile der Verweisliste – Richtung nur als Hinweis, fachlich sind
/// beide Seiten gleichwertig.
type Row = { id: string; note: string | null; peer: LinkedCase; outgoing: boolean }

export function InvestigationLinks({
  investigationId,
  linksFrom,
  linksTo,
  canManage,
  onChanged,
}: InvestigationLinksProps) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [open, setOpen] = useState(false)
  const [toId, setToId] = useState('')
  const [note, setNote] = useState('')

  const { data: cases } = useFetch<InvestigationListItem[]>(
    open && canManage ? '/api/investigations?status=ALL' : null,
  )

  const rows = useMemo<Row[]>(
    () => [
      ...linksFrom
        .filter((link) => link.to)
        .map((link) => ({ id: link.id, note: link.note, peer: link.to!, outgoing: true })),
      ...linksTo
        .filter((link) => link.from)
        .map((link) => ({ id: link.id, note: link.note, peer: link.from!, outgoing: false })),
    ],
    [linksFrom, linksTo],
  )

  const options = useMemo(() => {
    const taken = new Set(rows.map((row) => row.peer.id))
    taken.add(investigationId)
    return [
      { value: '', label: 'Akte wählen' },
      ...(cases ?? [])
        .filter((item) => !taken.has(item.id))
        .map((item) => ({ value: item.id, label: `${item.caseNumber} – ${item.title}` })),
    ]
  }, [cases, rows, investigationId])

  const handleLink = async () => {
    const ok = await mutate(`/api/investigations/${investigationId}/links`, {
      body: { toId, note },
      successTitle: 'Querverweis angelegt',
      errorTitle: 'Verweis fehlgeschlagen',
    })
    if (ok) {
      setToId('')
      setNote('')
      setOpen(false)
    }
  }

  const handleRemove = (row: Row) =>
    mutate(`/api/investigations/links/${row.id}`, {
      method: 'DELETE',
      successTitle: 'Querverweis entfernt',
      errorTitle: 'Entfernen fehlgeschlagen',
    })

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-white">Verwandte Akten ({rows.length})</h2>
          <p className="mt-0.5 text-[11.5px] text-[#6a6a6a]">
            Verweise auf Ermittlungen mit denselben Personen, Fahrzeugen oder Tatmustern.
          </p>
        </div>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Link2 className="h-3.5 w-3.5" />
            Verweisen
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-[12.5px] text-[#6a6a6a]">Keine Querverweise.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3">
              <Link
                href={`/investigations/${row.peer.id}`}
                className="min-w-0 flex-1 rounded-[9px] border border-[#232323] bg-[#111111] p-2.5 transition-colors hover:border-[#404040]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-[#6a6a6a]" />
                  <span className="font-mono text-[11.5px] text-[#d4af37]">{row.peer.caseNumber}</span>
                  <StatusBadge status={row.peer.status} />
                  <PriorityBadge priority={row.peer.priority} />
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-[#5a5a5a]">
                    {row.outgoing ? 'verweist auf' : 'verwiesen von'}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-white">{row.peer.title}</p>
                {row.note && <p className="mt-0.5 text-[12px] text-[#a6a6a6]">{row.note}</p>}
              </Link>

              {/* Nur die eigene Richtung ist von hier aus loesbar – der
                  Gegenverweis gehoert zur anderen Akte. */}
              {canManage && row.outgoing && (
                <button
                  type="button"
                  onClick={() => void handleRemove(row)}
                  className="mt-2 shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                  aria-label="Querverweis entfernen"
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
        title="Akte verknüpfen"
        description="Der Verweis erscheint in beiden Akten."
        size="lg"
      >
        <div className="space-y-4">
          <Select label="Zielakte" options={options} value={toId} onValueChange={setToId} />
          <Textarea
            label="Notiz"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Worin besteht der Zusammenhang?"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleLink} loading={saving} disabled={!toId}>
              Verknüpfen
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

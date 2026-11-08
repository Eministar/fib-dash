'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { INVESTIGATION_PERSON_ROLE_LABELS, INVESTIGATION_PRIORITY_LABELS, INVESTIGATION_STATUS_LABELS } from '@/lib/investigations/investigations'
import { IMPORT_LIMITS, type ImportDraft, type ImportRole } from '@/lib/investigations/fib-code-import'
import { labelOptions } from '@/components/investigations/investigation-badges'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import { formatDateTime } from '@/lib/utils'

interface PreviewResponse {
  draft: ImportDraft
  meta: {
    caseId: number
    affiliation: string
    issuedAt: string
    issuerName: string
    issuerBadge: string
    duplicateOf: { id: string; caseNumber: string; title: string } | null
  }
}

const ROLE_OPTIONS = labelOptions(INVESTIGATION_PERSON_ROLE_LABELS)

/**
 * Importiert einen FIB-Einsatzcode aus dem MDT: Code einfügen → Vorschau prüfen
 * und bearbeiten → Akte anlegen. Gespeichert wird erst nach Bestätigung.
 */
export function ImportCodeDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const router = useRouter()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading } = useApi<unknown>()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [dossierSearch, setDossierSearch] = useState('')
  const debouncedDossierSearch = useDebouncedValue(dossierSearch)
  const dossiers = useFetch<{ items: { id: string; title: string }[] }>(
    draft ? `/api/investigations/dossiers?search=${encodeURIComponent(debouncedDossierSearch)}` : null,
  )

  const reset = () => {
    setCode('')
    setError(null)
    setPreview(null)
    setDraft(null)
    setDossierSearch('')
  }
  const close = () => {
    reset()
    onClose()
  }

  const digits = code.replace(/\s+/g, '')

  const check = async () => {
    setError(null)
    try {
      const result = (await execute('/api/investigations/import-code/preview', {
        method: 'POST',
        body: JSON.stringify({ code: digits }),
      })) as PreviewResponse
      setPreview(result)
      setDraft(result.draft)
      setDossierSearch(result.meta.affiliation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Code konnte nicht gelesen werden.')
    }
  }

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) {
      toastError('Titel fehlt', 'Bitte einen Titel für die Akte angeben.')
      return
    }
    try {
      const created = (await execute('/api/investigations/import-code', {
        method: 'POST',
        body: JSON.stringify({ code: digits, draft }),
      })) as { id: string; caseNumber: string }
      toastSuccess('Akte angelegt', `${created.caseNumber} wurde aus dem Einsatzcode erstellt.`)
      onCreated?.()
      close()
      router.push(`/investigations/${created.id}`)
    } catch (cause) {
      toastError('Import fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const patch = (changes: Partial<ImportDraft>) => setDraft((previous) => (previous ? { ...previous, ...changes } : previous))
  const patchAt = <K extends 'persons' | 'vehicles' | 'items'>(key: K, index: number, changes: Partial<ImportDraft[K][number]>) =>
    setDraft((previous) =>
      previous
        ? { ...previous, [key]: previous[key].map((entry, i) => (i === index ? { ...entry, ...changes } : entry)) }
        : previous,
    )
  const removeAt = (key: 'persons' | 'vehicles' | 'items', index: number) =>
    setDraft((previous) => (previous ? { ...previous, [key]: previous[key].filter((_, i) => i !== index) } : previous))

  const duplicate = preview?.meta.duplicateOf ?? null

  return (
    <Modal
      open={open}
      onClose={close}
      title="Einsatzcode importieren"
      description={draft ? 'Angaben prüfen und bei Bedarf anpassen. Gespeichert wird erst nach Bestätigung.' : 'Den Zahlencode aus dem MDT (Akte → Einsatzcode) einfügen.'}
      size="xl"
    >
      {!draft || !preview ? (
        <div className="space-y-3">
          <Textarea
            label="Einsatzcode"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            rows={6}
            inputMode="numeric"
            spellCheck={false}
            autoFocus
            placeholder="Nur Ziffern, z. B. 1234567890 …"
            error={error ?? undefined}
          />
          <p className="text-xs text-[#98989d]">{digits.length ? `${digits.length.toLocaleString('de-DE')} Ziffern` : 'Leerzeichen und Zeilenumbrüche werden ignoriert.'}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Abbrechen</Button>
            <Button onClick={check} disabled={!digits} loading={loading}>Code prüfen</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-2 rounded-lg border border-[#30d158]/30 bg-[#30d158]/10 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#30d158]" />
            <p>
              Signatur gültig – Code stammt vom FIB-Server. Erfasst
              {preview.meta.issuerName ? ` von ${preview.meta.issuerName}${preview.meta.issuerBadge ? ` (${preview.meta.issuerBadge})` : ''}` : ''}
              {' '}am {formatDateTime(preview.meta.issuedAt)} aus MDT-Akte #{preview.meta.caseId}. Die Signatur belegt nur die Herkunft, nicht die inhaltliche Richtigkeit – bitte prüfen.
            </p>
          </div>

          {duplicate && (
            <div className="flex items-start gap-2 rounded-lg border border-[#ff9f0a]/40 bg-[#ff9f0a]/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9f0a]" />
              <p>
                Dieser Einsatz wurde bereits importiert:{' '}
                <Link href={`/investigations/${duplicate.id}`} className="underline" onClick={close}>{duplicate.caseNumber} – {duplicate.title}</Link>. Ein erneuter Import ist nicht möglich.
              </p>
            </div>
          )}

          <Input label="Titel" value={draft.title} maxLength={IMPORT_LIMITS.title} onChange={(e) => patch({ title: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Status" options={labelOptions(INVESTIGATION_STATUS_LABELS)} value={draft.status} onValueChange={(value) => patch({ status: value as ImportDraft['status'] })} />
            <Select label="Priorität" options={labelOptions(INVESTIGATION_PRIORITY_LABELS)} value={draft.priority} onValueChange={(value) => patch({ priority: value as ImportDraft['priority'] })} />
            <Input label="Einsatzdatum" type="date" value={draft.occurredDate} onChange={(e) => patch({ occurredDate: e.target.value })} />
            <Input label="Uhrzeit" type="time" value={draft.occurredTime} onChange={(e) => patch({ occurredTime: e.target.value })} />
          </div>
          <Input label="Ort" value={draft.location} maxLength={IMPORT_LIMITS.location} placeholder="Nicht angegeben" onChange={(e) => patch({ location: e.target.value })} />
          <Textarea label="Zusammenfassung" rows={6} value={draft.summary} maxLength={IMPORT_LIMITS.summary} onChange={(e) => patch({ summary: e.target.value })} />
          <div>
            <Textarea
              label="Einsatzbericht"
              rows={8}
              value={draft.report}
              maxLength={IMPORT_LIMITS.report}
              placeholder="Im Code war kein Bericht enthalten."
              onChange={(e) => patch({ report: e.target.value })}
            />
            <p className="mt-1 text-xs text-[#98989d]">
              {draft.report && !draft.occurredDate
                ? 'Ohne Einsatzdatum wird der Bericht in die Zusammenfassung übernommen statt als Chronologie-Eintrag.'
                : 'Wird als Einsatz-Eintrag in der Chronologie angelegt.'}
            </p>
          </div>

          <div className="space-y-2">
            <Input
              label="Familienakte zuordnen (optional)"
              value={dossierSearch}
              placeholder="Familienakte suchen …"
              onChange={(e) => setDossierSearch(e.target.value)}
            />
            <Select
              aria-label="Familienakte"
              value={draft.dossierId}
              onValueChange={(value) => patch({ dossierId: value })}
              options={[
                { value: '', label: dossiers.loading ? 'Familienakten werden geladen …' : 'Keine Familienakte' },
                ...(dossiers.data?.items ?? []).map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
            {preview.meta.affiliation && (
              <p className="text-xs text-[#98989d]">Zugehörigkeit laut MDT: {preview.meta.affiliation}. Es wird nichts automatisch zugeordnet.</p>
            )}
          </div>

          <ListSection title="Personen" count={draft.persons.length}>
            {draft.persons.map((person, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-[#48484a] p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_12rem_auto]">
                  <Input aria-label="Vorname" value={person.firstName} onChange={(e) => patchAt('persons', index, { firstName: e.target.value })} />
                  <Input aria-label="Nachname" value={person.lastName} onChange={(e) => patchAt('persons', index, { lastName: e.target.value })} />
                  <Select aria-label="Rolle" options={ROLE_OPTIONS} value={person.role} onValueChange={(value) => patchAt('persons', index, { role: value as ImportRole })} />
                  <RemoveButton label="Person entfernen" onClick={() => removeAt('persons', index)} />
                </div>
                <Textarea aria-label="Notiz" rows={person.note ? 3 : 1} placeholder="Notiz / Delikte" value={person.note} onChange={(e) => patchAt('persons', index, { note: e.target.value })} />
              </div>
            ))}
          </ListSection>

          <ListSection title="Fahrzeuge" count={draft.vehicles.length}>
            {draft.vehicles.map((vehicle, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
                <Input aria-label="Kennzeichen" value={vehicle.plate} onChange={(e) => patchAt('vehicles', index, { plate: e.target.value })} />
                <Input aria-label="Modell" placeholder="Modell" value={vehicle.model} onChange={(e) => patchAt('vehicles', index, { model: e.target.value })} />
                <Input aria-label="Halter" placeholder="Halter laut MDT" value={vehicle.owner} onChange={(e) => patchAt('vehicles', index, { owner: e.target.value })} />
                <RemoveButton label="Fahrzeug entfernen" onClick={() => removeAt('vehicles', index)} />
              </div>
            ))}
          </ListSection>

          <ListSection title="Asservate" count={draft.items.length}>
            {draft.items.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                <Input aria-label="Bezeichnung" value={item.title} onChange={(e) => patchAt('items', index, { title: e.target.value })} />
                <Input
                  aria-label="Menge"
                  numericOnly
                  placeholder="Menge"
                  value={item.quantity === null ? '' : String(item.quantity)}
                  onChange={(e) => patchAt('items', index, { quantity: e.target.value ? Number.parseInt(e.target.value, 10) : null })}
                />
                <RemoveButton label="Asservat entfernen" onClick={() => removeAt('items', index)} />
              </div>
            ))}
          </ListSection>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={reset}>Anderen Code eingeben</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={close}>Abbrechen</Button>
              <Button onClick={save} disabled={Boolean(duplicate)} loading={loading}>Akte anlegen</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ListSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title} <span className="text-[#98989d]">({count})</span></h3>
      {count === 0 ? <p className="text-sm text-[#98989d]">Keine Angaben im Code.</p> : children}
    </section>
  )
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" aria-label={label} title={label} onClick={onClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}

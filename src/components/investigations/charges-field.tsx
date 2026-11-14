'use client'

import { useMemo, useState } from 'react'
import { ExternalLink, Gavel, Scale, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { MAX_CHARGES, type Charge } from '@/lib/investigations/charges'

/** Norm, wie `/api/laws` sie liefert (siehe `NormEntry` in `lib/laws/laws`). */
export type LawNormView = {
  ref: string
  law: string
  lawName: string
  group: string
  label: string
  title: string
  section: string | null
  text: string
  url: string
  penal: boolean
}
type LawCatalogView = {
  source: string
  syncedAt: string
  origin: 'live' | 'fallback'
  laws: { abbr: string; name: string; group: string }[]
  norms: LawNormView[]
}

const HOUR = 60 * 60_000

/** Gesetzbuch live vom FJD – der Server hält es zwischengespeichert. */
export function useLawCatalog(enabled = true) {
  return useFetch<LawCatalogView>(enabled ? '/api/laws' : null, HOUR)
}

const toCharge = (norm: LawNormView): Charge => ({ ref: norm.ref, label: norm.label, title: norm.title })
const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')

/** Auswahl der Straftatbestände: suchen, nach Gesetz filtern, Normtext lesen, anhaken. */
export function ChargesPicker({ value, onChange }: { value: Charge[]; onChange: (next: Charge[]) => void }) {
  const catalog = useLawCatalog()
  const [query, setQuery] = useState('')
  const [law, setLaw] = useState<string>('')
  const [onlyPenal, setOnlyPenal] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const selected = new Set(value.map((charge) => charge.ref))

  const laws = useMemo(() => {
    const norms = catalog.data?.norms ?? []
    const withPenal = new Set(norms.filter((norm) => norm.penal).map((norm) => norm.law))
    return (catalog.data?.laws ?? []).filter((entry) => !onlyPenal || withPenal.has(entry.abbr))
  }, [catalog.data, onlyPenal])

  const results = useMemo(() => {
    const terms = fold(query).split(/\s+/).filter(Boolean)
    return (catalog.data?.norms ?? []).filter((norm) => {
      if (onlyPenal && !norm.penal) return false
      if (law && norm.law !== law) return false
      if (!terms.length) return true
      const haystack = fold(`${norm.label} ${norm.law} ${norm.title} ${norm.lawName} ${norm.text}`)
      return terms.every((term) => haystack.includes(term))
    }).slice(0, 80)
  }, [catalog.data, query, law, onlyPenal])

  const toggle = (norm: LawNormView) => {
    if (selected.has(norm.ref)) onChange(value.filter((charge) => charge.ref !== norm.ref))
    else if (value.length < MAX_CHARGES) onChange([...value, toCharge(norm)])
  }

  return (
    <div className="space-y-3">
      <div className="min-h-[44px] rounded-[10px] border border-[#38383a] bg-[#0f0f10] p-2">
        {value.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Ausgewählte Straftatbestände">
            {value.map((charge) => (
              <li key={charge.ref} className="inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 py-1 pl-2.5 pr-1 text-[12px] text-[#f5e6b8]">
                <span className="font-semibold tabular-nums">{charge.label}</span>
                {charge.title && <span className="text-[#e8d8a8]">{charge.title}</span>}
                <button type="button" onClick={() => onChange(value.filter((item) => item.ref !== charge.ref))} aria-label={`${charge.label} entfernen`} className="rounded-full p-0.5 text-[#d4af37] hover:bg-[#d4af37]/20 hover:text-white">
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1.5 py-1 text-[12.5px] text-[#8e8e93]">Noch keine Straftatbestände gewählt.</p>
        )}
      </div>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8e8e93]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Suchen: „Diebstahl“, „§ 4 BtMG“, „Waffe“ …"
          aria-label="Gesetzbuch durchsuchen"
          className="h-10 w-full rounded-[10px] border border-[#38383a] bg-[#1c1c1e] pl-9 pr-3 text-[13px] text-white placeholder:text-[#6e6e73] focus:border-[#d4af37] focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={!law} onClick={() => setLaw('')}>Alle</FilterChip>
        {laws.map((entry) => (
          <FilterChip key={entry.abbr} active={law === entry.abbr} onClick={() => setLaw(law === entry.abbr ? '' : entry.abbr)} title={entry.name}>{entry.abbr}</FilterChip>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[#98989d]">
          <input type="checkbox" checked={onlyPenal} onChange={(event) => { setOnlyPenal(event.target.checked); setLaw('') }} />
          nur Normen mit Strafandrohung
        </label>
      </div>

      <div className="max-h-[340px] overflow-auto rounded-[10px] border border-[#2c2c2e]">
        {catalog.loading && !catalog.data ? (
          <p className="p-4 text-[12.5px] text-[#8e8e93]">Gesetzbuch wird vom FJD geladen …</p>
        ) : catalog.error ? (
          <p role="alert" className="p-4 text-[12.5px] text-[#fca5a5]">Gesetzbuch nicht erreichbar: {catalog.error}</p>
        ) : results.length ? (
          <ul className="divide-y divide-[#2c2c2e]">
            {results.map((norm) => {
              const checked = selected.has(norm.ref)
              const expanded = open === norm.ref
              return (
                <li key={norm.ref} className={checked ? 'bg-[#d4af37]/[0.06]' : ''}>
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={!checked && value.length >= MAX_CHARGES}
                      onChange={() => toggle(norm)}
                      aria-label={`${norm.label} ${norm.title}`}
                    />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : norm.ref)} aria-expanded={expanded}>
                      <span className="block text-[13px] text-white">
                        <span className="font-semibold tabular-nums text-[#f5e6b8]">{norm.label}</span>
                        {norm.title && <span> · {norm.title}</span>}
                      </span>
                      <span className={`mt-0.5 block whitespace-pre-line text-[11.5px] leading-relaxed text-[#98989d] ${expanded ? '' : 'line-clamp-2'}`}>{norm.text}</span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="p-4 text-[12.5px] text-[#8e8e93]">Keine passende Norm gefunden.</p>
        )}
      </div>
      {catalog.data && (
        <p className="text-[11px] text-[#6e6e73]">
          Quelle: <a href={catalog.data.source} target="_blank" rel="noreferrer" className="underline hover:text-[#98989d]">Gesetzbuch des Federal Justice Department</a>
          {catalog.data.origin === 'fallback' ? ' · Seite gerade nicht erreichbar, letzter gespeicherter Stand' : ` · Stand ${new Date(catalog.data.syncedAt).toLocaleString('de-DE')}`}
        </p>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${active ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#f5e6b8]' : 'border-[#38383a] text-[#98989d] hover:border-[#5a5a5e] hover:text-white'}`}
    >
      {children}
    </button>
  )
}

/** Anzeige in der Akte: Fundstelle, Überschrift und auf Klick der Normtext. */
export function ChargesSummary({ charges, canEdit, onEdit }: { charges: Charge[]; canEdit: boolean; onEdit: () => void }) {
  const catalog = useLawCatalog(charges.length > 0)
  const [open, setOpen] = useState<string | null>(null)
  const norm = open ? catalog.data?.norms.find((item) => item.ref === open) : null
  if (!charges.length && !canEdit) return null

  return (
    <div className="mt-4 border-t border-[#2c2c2e] pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#8e8e93]"><Scale size={13} aria-hidden /> Straftatbestände</h2>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Gavel size={13} />
            {charges.length ? 'Bearbeiten' : 'Angeben'}
          </Button>
        )}
      </div>
      {charges.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {charges.map((charge) => (
            <li key={charge.ref}>
              <button
                type="button"
                onClick={() => setOpen(open === charge.ref ? null : charge.ref)}
                aria-expanded={open === charge.ref}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${open === charge.ref ? 'border-[#d4af37] bg-[#d4af37]/20 text-white' : 'border-[#d4af37]/35 bg-[#d4af37]/[0.08] text-[#f5e6b8] hover:border-[#d4af37]'}`}
              >
                <span className="font-semibold tabular-nums">{charge.label}</span>
                {charge.title && <span className="text-[#e8d8a8]">{charge.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-[#8e8e93]">Noch nicht angegeben – wird im Razzia-Antrag automatisch übernommen.</p>
      )}
      {open && (
        <div className="mt-3 rounded-[10px] border border-[#2c2c2e] bg-[#0f0f10] p-3.5">
          {norm ? (
            <>
              <p className="text-[12.5px] font-semibold text-white">{norm.label} · {norm.title} <span className="font-normal text-[#8e8e93]">({norm.lawName})</span></p>
              <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-[#c7c7cc]">{norm.text}</p>
              <a href={norm.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[#d4af37] hover:underline">Im Gesetzbuch öffnen <ExternalLink size={11} /></a>
            </>
          ) : (
            <p className="text-[12px] text-[#8e8e93]">{catalog.loading ? 'Normtext wird geladen …' : 'Diese Norm steht nicht mehr im aktuellen Gesetzbuch.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Dialog zum Bearbeiten der Straftatbestände einer bestehenden Akte. */
export function ChargesDialog({ initial, onClose, onSave }: { initial: Charge[]; onClose: () => void; onSave: (charges: Charge[]) => Promise<void> }) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <Modal open onClose={saving ? () => {} : onClose} title="Straftatbestände" description="Gegen welche Normen wurde verstoßen? Grundlage ist das Gesetzbuch des FJD." size="lg">
      <ChargesPicker value={value} onChange={setValue} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Abbrechen</Button>
        <Button loading={saving} onClick={async () => { setSaving(true); try { await onSave(value) } finally { setSaving(false) } }}>Speichern</Button>
      </div>
    </Modal>
  )
}

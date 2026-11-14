'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, RefreshCw, Scale } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { RAID_MEASURES, RAID_URGENCY, type RaidAttachment, type RaidMeasure, type RaidRequest, type RaidUrgency } from '@/lib/investigations/raid-request'
import { raidRequestSchema } from '@/lib/investigations/raid-request-schema'
import { RaidRequestDocument } from './raid-request-document'
import type { ShareSelection } from '@/lib/investigations/record-share-kinds'
import type { Charge } from '@/lib/investigations/charges'

type Prefill = Pick<RaidRequest, 'target' | 'address' | 'suspects' | 'offenses' | 'facts'> & { charges: Charge[] }
const PREFILL_FIELDS = ['target', 'address', 'suspects', 'offenses', 'facts'] as const

/** Eingaben für den Razzia-Antrag. Der förmliche Text entsteht daraus automatisch. */
export function RaidRequestFields({ value, onChange, attachments, items }: {
  value: RaidRequest
  onChange: (next: RaidRequest) => void
  attachments: RaidAttachment[]
  /** Ausgewählte Akten – daraus wird der Antrag automatisch vorbefüllt. */
  items: ShareSelection[]
}) {
  const [preview, setPreview] = useState(false)
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [prefillState, setPrefillState] = useState<'idle' | 'loading' | 'error'>('idle')
  // Was zuletzt automatisch eingetragen wurde: solange der Nutzer es nicht ändert, darf es nachgezogen werden.
  const lastAuto = useRef<Partial<Record<typeof PREFILL_FIELDS[number], string>>>({})
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const itemsKey = items.map((item) => `${item.kind}:${item.recordId}`).sort().join('|')

  const apply = (data: Prefill, force: boolean) => {
    const current = valueRef.current
    const next = { ...current }
    for (const field of PREFILL_FIELDS) {
      const untouched = !current[field].trim() || current[field] === lastAuto.current[field]
      if ((force || untouched) && (data[field] || untouched)) {
        next[field] = data[field]
        lastAuto.current[field] = data[field]
      }
    }
    onChangeRef.current(next)
  }

  useEffect(() => {
    if (!itemsKey) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setPrefillState('loading')
      try {
        const response = await fetch('/api/record-shares/raid-prefill', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: itemsKey.split('|').map((key) => { const [kind, recordId] = key.split(':'); return { kind, recordId } }) }),
          signal: controller.signal,
        })
        const body = await response.json() as { success?: boolean; data?: Prefill }
        if (!response.ok || !body.data) throw new Error('prefill')
        setPrefill(body.data)
        apply(body.data, false)
        setPrefillState('idle')
      } catch (cause) {
        if (!controller.signal.aborted) setPrefillState('error')
        void cause
      }
    }, 450)
    return () => { window.clearTimeout(timer); controller.abort() }
    // `apply` liest über Refs, die Auswahl ist der einzige Auslöser.
  }, [itemsKey])
  const set = <K extends keyof RaidRequest>(key: K, next: RaidRequest[K]) => onChange({ ...value, [key]: next })
  const toggleMeasure = (measure: RaidMeasure, on: boolean) =>
    set('measures', on ? [...value.measures, measure] : value.measures.filter((item) => item !== measure))
  const check = raidRequestSchema.safeParse(value)

  return (
    <section className="space-y-4 rounded-[12px] border border-[#d4af37]/30 bg-[#d4af37]/[0.04] p-4">
      <div>
        <h3 className="text-[14px] font-semibold text-white">Razzia-Antrag</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[#98989d]">
          Der Link wird zum förmlichen Antrag an das Gericht: Anschreiben im Namen des FIB, die ausgewählten Akten unten werden zu den Anlagen.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#38383a] bg-[#0f0f10] px-3 py-2">
        <p className="flex items-center gap-1.5 text-[12px] text-[#98989d]">
          <Scale size={13} className="text-[#d4af37]" aria-hidden />
          {!items.length
            ? 'Akten unten auswählen – Tatvorwürfe, Betroffene, Objekt und Sachverhalt werden daraus automatisch übernommen.'
            : prefillState === 'loading'
              ? 'Übernehme Angaben aus den Akten …'
              : prefillState === 'error'
                ? 'Angaben aus den Akten konnten nicht geladen werden.'
                : prefill
                  ? `Aus den Akten übernommen · ${prefill.charges.length} Straftatbestände`
                  : 'Angaben aus den Akten werden übernommen.'}
        </p>
        {prefill && (
          <Button type="button" variant="ghost" size="sm" onClick={() => apply(prefill, true)} title="Überschreibt Zielobjekt, Anschrift, Betroffene, Tatvorwürfe und Sachverhalt mit den Angaben aus den Akten">
            <RefreshCw size={13} />
            Neu aus Akten übernehmen
          </Button>
        )}
      </div>

      <Input label="Empfänger" maxLength={200} value={value.recipient} onChange={(event) => set('recipient', event.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Zielobjekt" required maxLength={200} value={value.target} onChange={(event) => set('target', event.target.value)} placeholder="z. B. Anwesen der Familie Moretti" />
        <Input label="Anschrift / Lage (optional)" maxLength={300} value={value.address} onChange={(event) => set('address', event.target.value)} placeholder="z. B. Vinewood Hills, North Sheldon Ave." />
      </div>
      <Textarea label="Betroffene Personen (optional)" rows={2} maxLength={2000} value={value.suspects} onChange={(event) => set('suspects', event.target.value)} placeholder="Namen, ggf. mit Personennummer" />
      <Textarea label="Tatvorwürfe" required rows={Math.min(6, Math.max(2, value.offenses.split('\n').length))} maxLength={2000} value={value.offenses} onChange={(event) => set('offenses', event.target.value)} placeholder="Kommt automatisch aus den Straftatbeständen der Akten – je Zeile ein Vorwurf, z. B. § 4 BtMG – Unerlaubter Umgang mit Betäubungsmitteln" />
      <Textarea label="Sachverhalt" required rows={7} maxLength={12000} value={value.facts} onChange={(event) => set('facts', event.target.value)} placeholder="Was wurde wann festgestellt? Absätze mit Leerzeile trennen." />

      <fieldset>
        <legend className="mb-2 text-[12.5px] font-medium text-[#98989d]">Beantragte Maßnahmen</legend>
        <div className="space-y-2">
          {(Object.keys(RAID_MEASURES) as RaidMeasure[]).map((measure) => (
            <Checkbox key={measure} label={RAID_MEASURES[measure]} checked={value.measures.includes(measure)} onCheckedChange={(on) => toggleMeasure(measure, on)} />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Dringlichkeit"
          value={value.urgency}
          onValueChange={(urgency) => set('urgency', urgency as RaidUrgency)}
          options={(Object.keys(RAID_URGENCY) as RaidUrgency[]).map((key) => ({ value: key, label: RAID_URGENCY[key] }))}
        />
        <Input label="Zeitraum der Durchführung (optional)" maxLength={200} value={value.window} onChange={(event) => set('window', event.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Antragsteller" required maxLength={200} value={value.applicantName} onChange={(event) => set('applicantName', event.target.value)} />
        <Input label="Dienstgrad" maxLength={120} value={value.applicantRank} onChange={(event) => set('applicantRank', event.target.value)} placeholder="z. B. Special Agent" />
        <Input label="Dienstnummer" maxLength={60} value={value.applicantBadge} onChange={(event) => set('applicantBadge', event.target.value)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-[#8e8e93]">
          {check.success ? `${attachments.length} Anlagen · bereit` : check.error.issues[0]?.message}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setPreview(true)}>
          <FileText size={14} />
          Vorschau des Schreibens
        </Button>
      </div>

      {preview && (
        <Modal open onClose={() => setPreview(false)} title="Vorschau Razzia-Antrag" size="xl">
          <div className="max-h-[75vh] overflow-auto">
            <RaidRequestDocument request={value} reference="FIB-RA-ENTWURF" createdAt={new Date()} attachments={attachments} />
          </div>
        </Modal>
      )}
    </section>
  )
}

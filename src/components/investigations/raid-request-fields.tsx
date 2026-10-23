'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { RAID_MEASURES, RAID_URGENCY, type RaidAttachment, type RaidMeasure, type RaidRequest, type RaidUrgency } from '@/lib/investigations/raid-request'
import { raidRequestSchema } from '@/lib/investigations/raid-request-schema'
import { RaidRequestDocument } from './raid-request-document'

/** Eingaben für den Razzia-Antrag. Der förmliche Text entsteht daraus automatisch. */
export function RaidRequestFields({ value, onChange, attachments }: {
  value: RaidRequest
  onChange: (next: RaidRequest) => void
  attachments: RaidAttachment[]
}) {
  const [preview, setPreview] = useState(false)
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

      <Input label="Empfänger" maxLength={200} value={value.recipient} onChange={(event) => set('recipient', event.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Zielobjekt" required maxLength={200} value={value.target} onChange={(event) => set('target', event.target.value)} placeholder="z. B. Anwesen der Familie Moretti" />
        <Input label="Anschrift / Lage (optional)" maxLength={300} value={value.address} onChange={(event) => set('address', event.target.value)} placeholder="z. B. Vinewood Hills, North Sheldon Ave." />
      </div>
      <Textarea label="Betroffene Personen (optional)" rows={2} maxLength={2000} value={value.suspects} onChange={(event) => set('suspects', event.target.value)} placeholder="Namen, ggf. mit Personennummer" />
      <Textarea label="Tatvorwürfe" required rows={2} maxLength={2000} value={value.offenses} onChange={(event) => set('offenses', event.target.value)} placeholder="z. B. Bandenmäßiger Handel mit Betäubungsmitteln, unerlaubter Waffenbesitz" />
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

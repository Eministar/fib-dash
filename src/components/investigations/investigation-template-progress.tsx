'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { SectionCard } from '@/components/ui/section-card'
import { useInvestigationMutation } from './use-investigation-mutation'
import { readChecklist, readOpenRoles, TEMPLATE_LIMITS } from '@/lib/investigation-templates'
import { INVESTIGATION_PERSON_ROLE_LABELS } from '@/lib/investigations'
import { formatDateTime } from '@/lib/utils'
import type { InvestigationDetail, Person } from './types'

export function InvestigationTemplateProgress({ investigation, persons, canManage, onChanged }: {
  investigation: InvestigationDetail
  persons: Person[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState<Record<string, string>>({})
  const checklist = readChecklist(investigation.checklist)
  const roles = readOpenRoles(investigation.openRoles)
  const base = `/api/investigations/${investigation.id}`

  if (!canManage && !checklist.length && !roles.length && !investigation.template) return null

  return <SectionCard title="Arbeitsplan">
    <div className="space-y-5">
      {investigation.template && <p className="text-xs text-[#98989d]">Aus Vorlage „{investigation.template.name}“</p>}
      <div className="space-y-3">
        <p className="text-sm text-[#98989d]">Checkliste · {checklist.filter(item => item.done).length} von {checklist.length} erledigt</p>
        {checklist.map(item => <div key={item.id} className="flex items-start justify-between gap-3">
          <div>
            <Checkbox label={item.label} checked={item.done} disabled={!canManage || saving} onCheckedChange={done => void mutate(`${base}/checklist`, { method: 'PATCH', body: { action: 'toggle', itemId: item.id, done } })} />
            {item.done && item.doneAt && <p className="ml-7 mt-1 text-xs text-[#98989d]">{item.doneBy} · {formatDateTime(item.doneAt)}</p>}
          </div>
          {canManage && <Button variant="ghost" size="sm" disabled={saving} onClick={() => void mutate(`${base}/checklist`, { method: 'PATCH', body: { action: 'remove', itemId: item.id } })}>Entfernen</Button>}
        </div>)}
        {canManage && checklist.length < TEMPLATE_LIMITS.checklistItems && <form className="flex items-end gap-2" onSubmit={async event => {
          event.preventDefault()
          if (await mutate(`${base}/checklist`, { method: 'PATCH', body: { action: 'add', label } })) setLabel('')
        }}>
          <Input label="Neuer Arbeitsschritt" value={label} maxLength={TEMPLATE_LIMITS.checklistLabel} onChange={event => setLabel(event.target.value)} />
          <Button type="submit" disabled={saving || !label.trim()}>Hinzufügen</Button>
        </form>}
      </div>
      {roles.length > 0 && <div className="space-y-3">
        <h3 className="text-sm font-medium">Offene Beteiligte</h3>
        {roles.map(slot => <div key={slot.id} className="space-y-2 rounded-lg border border-[#3a3a3c] p-3">
          <p className="text-sm">{slot.label} <span className="text-[#98989d]">· {INVESTIGATION_PERSON_ROLE_LABELS[slot.role]}</span></p>
          {canManage && <div className="flex flex-wrap items-end gap-2">
            <Select label={`Person für ${slot.label}`} value={selected[slot.id] ?? ''} onValueChange={value => setSelected(previous => ({ ...previous, [slot.id]: value }))} options={[
              { value: '', label: 'Person wählen' },
              ...persons.filter(person => !investigation.persons.some(link => link.personId === person.id && link.role === slot.role)).map(person => ({ value: person.id, label: `${person.firstName} ${person.lastName} (${person.personNumber})` })),
            ]} />
            <Button disabled={saving || !selected[slot.id]} onClick={() => void mutate(`${base}/open-roles`, { body: { roleId: slot.id, personId: selected[slot.id] }, successTitle: 'Person zugeordnet' })}>Zuordnen</Button>
            <Button variant="ghost" disabled={saving} onClick={() => void mutate(`${base}/open-roles`, { method: 'DELETE', body: { roleId: slot.id } })}>Verwerfen</Button>
          </div>}
        </div>)}
      </div>}
    </div>
  </SectionCard>
}

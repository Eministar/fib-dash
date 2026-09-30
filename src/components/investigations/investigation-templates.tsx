'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { PageLoader } from '@/components/ui/loading'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { INVESTIGATION_PERSON_ROLE_LABELS, INVESTIGATION_PRIORITY_LABELS } from '@/lib/investigations'
import { TEMPLATE_LIMITS, type InvestigationTemplateData, type TemplateInput, type TemplateRole } from '@/lib/investigation-templates'
import { labelOptions } from './investigation-badges'
import { AgentPicker } from './agent-picker'
import { useInvestigationMutation } from './use-investigation-mutation'
import type { AgentLite } from './types'

const emptyForm = (): TemplateInput => ({ name: '', description: '', titlePrefix: '', summary: '', priority: 'NORMAL', classified: false, checklist: [], roles: [], leadAgentId: null, assigneeIds: [], active: true, sortOrder: 0 })

export function InvestigationTemplates() {
  const { user } = useAuth()
  const allowed = hasPermission(user, 'investigations:templates')
  const { data, loading, error, refetch } = useFetch<InvestigationTemplateData[]>(allowed ? '/api/investigation-templates?all=1' : null)
  const { data: agents, error: agentsError } = useFetch<AgentLite[]>(allowed ? '/api/agents' : null)
  const { mutate, saving } = useInvestigationMutation(refetch)
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TemplateInput>(emptyForm)
  const [checklistText, setChecklistText] = useState('')

  const edit = (template?: InvestigationTemplateData) => {
    setEditingId(template?.id ?? null)
    setForm(template ? { ...template, roles: template.roles.map(role => ({ ...role })) } : emptyForm())
    setChecklistText(template?.checklist.join('\n') ?? '')
    setOpen(true)
  }
  const updateRole = (index: number, patch: Partial<TemplateRole>) => setForm(previous => ({ ...previous, roles: previous.roles.map((role, i) => i === index ? { ...role, ...patch } : role) }))

  if (!allowed) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  return <div className="space-y-5">
    <Link href="/investigations" className="text-sm text-[#c4b5fd] hover:underline">Zurück zu den Einsatzakten</Link>
    <PageHeader title="Aktenvorlagen" description="Vorbereitete Abschnitte, Arbeitsschritte und Zuständigkeiten für neue Einsatzakten. Änderungen gelten nur für künftig angelegte Akten." action={<Button onClick={() => edit()}>Neue Vorlage</Button>} />
    {error ? <Card><p role="alert">{error}</p><Button variant="ghost" onClick={() => void refetch()}>Erneut laden</Button></Card> : !data?.length ? <Card><p className="text-sm text-[#98989d]">Noch keine Vorlagen vorhanden. Lege beispielsweise eine Vorlage für Drogen, Korruption oder Raub an.</p></Card> : <div className="grid gap-4 md:grid-cols-2">
      {data.map(template => <Card key={template.id}>
        <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{template.name}</h2><span className="text-xs text-[#98989d]">{template.active ? 'Aktiv' : 'Deaktiviert'}</span></div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[#98989d]">{template.description}</p>
        <p className="mt-3 text-xs text-[#98989d]">{template.checklist.length} Arbeitsschritte · {template.roles.length} offene Rollen · {template.usageCount ?? 0} Akten</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => edit(template)}>Bearbeiten</Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void mutate(`/api/investigation-templates/${template.id}`, { method: 'PATCH', body: { ...template, active: !template.active } })}>{template.active ? 'Deaktivieren' : 'Aktivieren'}</Button>
          <Button size="sm" variant="danger" disabled={saving} onClick={async () => {
            if (await confirm({ title: 'Vorlage löschen?', description: `„${template.name}“ wird gelöscht. Bestehende Akten behalten ihre Inhalte.`, confirmLabel: 'Löschen', tone: 'danger' })) await mutate(`/api/investigation-templates/${template.id}`, { method: 'DELETE', successTitle: 'Vorlage gelöscht' })
          }}>Löschen</Button>
        </div>
      </Card>)}
    </div>}
    <Modal open={open} onClose={() => { if (!saving) setOpen(false) }} title={editingId ? 'Vorlage bearbeiten' : 'Neue Aktenvorlage'} size="xl">
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault()
        const ok = await mutate(editingId ? `/api/investigation-templates/${editingId}` : '/api/investigation-templates', { method: editingId ? 'PATCH' : 'POST', body: { ...form, checklist: checklistText.split('\n') }, successTitle: 'Vorlage gespeichert' })
        if (ok) setOpen(false)
      }}>
        <fieldset disabled={saving} className="space-y-4">
          <Input label="Name" required maxLength={TEMPLATE_LIMITS.name} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          <Textarea label="Beschreibung" maxLength={TEMPLATE_LIMITS.description} value={form.description ?? ''} onChange={event => setForm({ ...form, description: event.target.value })} />
          <Input label="Titelpräfix" placeholder="Drogen –" maxLength={TEMPLATE_LIMITS.titlePrefix} value={form.titlePrefix ?? ''} onChange={event => setForm({ ...form, titlePrefix: event.target.value })} />
          <Textarea label="Vorbereitete Abschnitte" rows={7} placeholder={'Sachverhalt\n\nErmittlungsstand\n\nWeitere Maßnahmen'} maxLength={TEMPLATE_LIMITS.summary} value={form.summary ?? ''} onChange={event => setForm({ ...form, summary: event.target.value })} />
          <Textarea label={`Checkliste (ein Arbeitsschritt pro Zeile, maximal ${TEMPLATE_LIMITS.checklistItems})`} rows={5} value={checklistText} onChange={event => setChecklistText(event.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Priorität" value={form.priority} options={labelOptions(INVESTIGATION_PRIORITY_LABELS)} onValueChange={value => setForm({ ...form, priority: value as TemplateInput['priority'] })} />
            <Input label="Sortierung" type="number" min={0} max={9999} value={form.sortOrder} onChange={event => setForm({ ...form, sortOrder: Number(event.target.value) })} />
          </div>
          <Checkbox label="Verschlusssache" checked={form.classified} onCheckedChange={classified => setForm({ ...form, classified })} />
          <Checkbox label="Vorlage aktiv" checked={form.active} onCheckedChange={active => setForm({ ...form, active })} />
          {agentsError && <p role="alert" className="text-sm text-red-400">Agents konnten nicht geladen werden: {agentsError}</p>}
          <AgentPicker single label="Fallführung" agents={agents ?? []} value={form.leadAgentId ? [form.leadAgentId] : []} onChange={ids => setForm({ ...form, leadAgentId: ids[0] ?? null })} />
          <AgentPicker agents={agents ?? []} value={form.assigneeIds} onChange={assigneeIds => setForm({ ...form, assigneeIds })} />
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Rollen-Platzhalter</h3>
            {form.roles.map((role, index) => <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-[#3a3a3c] p-3">
              <Select label="Rolle" value={role.role} options={labelOptions(INVESTIGATION_PERSON_ROLE_LABELS)} onValueChange={value => updateRole(index, { role: value as TemplateRole['role'] })} />
              <Input label="Bezeichnung" maxLength={TEMPLATE_LIMITS.roleLabel} value={role.label} onChange={event => updateRole(index, { label: event.target.value })} />
              <Button type="button" variant="ghost" onClick={() => setForm({ ...form, roles: form.roles.filter((_, i) => i !== index) })}>Entfernen</Button>
            </div>)}
            <Button type="button" variant="ghost" disabled={form.roles.length >= TEMPLATE_LIMITS.roles} onClick={() => setForm({ ...form, roles: [...form.roles, { role: 'SUSPECT', label: 'Tatverdächtiger' }] })}>Rolle hinzufügen</Button>
          </div>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>Abbrechen</Button><Button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'Speichert …' : 'Speichern'}</Button></div>
      </form>
    </Modal>
  </div>
}

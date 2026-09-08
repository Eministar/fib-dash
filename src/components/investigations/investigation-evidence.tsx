'use client'

import { useState } from 'react'
import { Boxes, MapPin, Package, Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { labelOptions } from '@/components/investigations/investigation-badges'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_STATUS_LABELS,
  type EvidenceStatusKey,
} from '@/lib/investigations'
import { formatDateTime } from '@/lib/utils'
import type { AgentLite, Evidence, InvestigationEntry } from '@/components/investigations/types'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

const STATUS_VARIANTS: Record<EvidenceStatusKey, BadgeVariant> = {
  SECURED: 'success',
  IN_ANALYSIS: 'info',
  RELEASED: 'default',
  DESTROYED: 'warning',
  LOST: 'danger',
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

type EvidenceForm = {
  title: string
  kind: string
  status: string
  quantity: string
  description: string
  seizedAt: string
  seizedLocation: string
  storageLocation: string
  seizedByAgentId: string
  entryId: string
}

function emptyForm(): EvidenceForm {
  return {
    title: '',
    kind: 'OTHER',
    status: 'SECURED',
    quantity: '',
    description: '',
    seizedAt: localDateTimeValue(),
    seizedLocation: '',
    storageLocation: '',
    seizedByAgentId: '',
    entryId: '',
  }
}

interface InvestigationEvidenceProps {
  investigationId: string
  evidence: Evidence[]
  entries: InvestigationEntry[]
  agents: AgentLite[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

export function InvestigationEvidence({
  investigationId,
  evidence,
  entries,
  agents,
  canManage,
  onChanged,
}: InvestigationEvidenceProps) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<EvidenceForm>(emptyForm)

  const set = <K extends keyof EvidenceForm>(key: K, value: EvidenceForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleCreate = async () => {
    const ok = await mutate(`/api/investigations/${investigationId}/evidence`, {
      body: {
        ...form,
        quantity: form.quantity || null,
        seizedAt: form.seizedAt ? new Date(form.seizedAt).toISOString() : null,
        seizedByAgentId: form.seizedByAgentId || null,
        entryId: form.entryId || null,
      },
      successTitle: 'Asservat erfasst',
      successMessage: `"${form.title}" wurde der Akte hinzugefügt.`,
      errorTitle: 'Erfassen fehlgeschlagen',
    })
    if (ok) {
      setForm(emptyForm())
      setOpen(false)
    }
  }

  const handleStatusChange = (item: Evidence, status: string) =>
    mutate(`/api/investigations/evidence/${item.id}`, {
      method: 'PATCH',
      body: { status },
      successTitle: 'Status geändert',
      successMessage: `${item.itemNumber} ist jetzt „${EVIDENCE_STATUS_LABELS[status as EvidenceStatusKey]}".`,
      errorTitle: 'Änderung fehlgeschlagen',
    })

  const handleDelete = (item: Evidence) => {
    if (!window.confirm(`Asservat ${item.itemNumber} „${item.title}" löschen?`)) return
    return mutate(`/api/investigations/evidence/${item.id}`, {
      method: 'DELETE',
      successTitle: 'Asservat gelöscht',
      errorTitle: 'Löschen fehlgeschlagen',
    })
  }

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-white">Asservate ({evidence.length})</h2>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Erfassen
          </Button>
        )}
      </div>

      {evidence.length === 0 ? (
        <p className="py-3 text-[12.5px] text-[#6a6a6a]">Keine Asservate zu dieser Akte.</p>
      ) : (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-[10px] border border-[#232323] bg-[#111111] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11.5px] text-[#d4af37]">{item.itemNumber}</span>
                    <Badge>{EVIDENCE_KIND_LABELS[item.kind]}</Badge>
                    <Badge variant={STATUS_VARIANTS[item.status]}>
                      {EVIDENCE_STATUS_LABELS[item.status]}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[13.5px] font-medium text-white">
                    {item.quantity ? `${item.quantity}× ` : ''}
                    {item.title}
                  </p>
                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
                      {item.description}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#6a6a6a]">
                    {item.seizedAt && <span>Sichergestellt {formatDateTime(item.seizedAt)}</span>}
                    {item.seizedLocation && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {item.seizedLocation}
                      </span>
                    )}
                    {item.storageLocation && (
                      <span className="inline-flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" />
                        {item.storageLocation}
                      </span>
                    )}
                    {item.seizedByAgent && (
                      <span>
                        durch {item.seizedByAgent.firstName} {item.seizedByAgent.lastName}
                      </span>
                    )}
                    {item.entry && <span>zu &bdquo;{item.entry.title}&ldquo;</span>}
                  </div>
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      size="sm"
                      options={labelOptions(EVIDENCE_STATUS_LABELS)}
                      value={item.status}
                      onValueChange={(value) => void handleStatusChange(item, value)}
                    />
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                      aria-label="Asservat löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Asservat erfassen"
        description="Die Asservatennummer wird automatisch vergeben."
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Bezeichnung"
            value={form.title}
            onChange={(event) => set('title', event.target.value)}
            placeholder="z. B. Pistole Vom Feuer, Seriennummer entfernt"
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Art"
              options={labelOptions(EVIDENCE_KIND_LABELS)}
              value={form.kind}
              onValueChange={(value) => set('kind', value)}
            />
            <Select
              label="Status"
              options={labelOptions(EVIDENCE_STATUS_LABELS)}
              value={form.status}
              onValueChange={(value) => set('status', value)}
            />
            <Input
              label="Menge"
              numericOnly
              value={form.quantity}
              onChange={(event) => set('quantity', event.target.value)}
              placeholder="1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Sichergestellt am"
              type="datetime-local"
              value={form.seizedAt}
              onChange={(event) => set('seizedAt', event.target.value)}
            />
            <Input
              label="Fundort"
              value={form.seizedLocation}
              onChange={(event) => set('seizedLocation', event.target.value)}
              placeholder="z. B. Kofferraum, Route 68"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Sichergestellt durch"
              options={[
                { value: '', label: 'Nicht zugeordnet' },
                ...agents.map((agent) => ({
                  value: agent.id,
                  label: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
                })),
              ]}
              value={form.seizedByAgentId}
              onValueChange={(value) => set('seizedByAgentId', value)}
            />
            <Select
              label="Zu Eintrag"
              options={[
                { value: '', label: 'Kein Eintrag' },
                ...entries.map((entry) => ({ value: entry.id, label: entry.title })),
              ]}
              value={form.entryId}
              onValueChange={(value) => set('entryId', value)}
            />
          </div>

          <Input
            label="Verwahrort"
            value={form.storageLocation}
            onChange={(event) => set('storageLocation', event.target.value)}
            placeholder="z. B. Asservatenkammer Fach 12"
          />

          <Textarea
            label="Beschreibung"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            rows={3}
          />

          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#6a6a6a]">
              <Boxes className="h-3.5 w-3.5" />
              Nummer wird automatisch vergeben
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleCreate} loading={saving}>
                Erfassen
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ShieldCheck, UserPlus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { AgentPicker } from '@/components/investigations/agent-picker'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { formatDateTime } from '@/lib/utils'
import type { AgentLite, InvestigationAssignee } from '@/components/investigations/types'

interface InvestigationAssigneesProps {
  investigationId: string
  assignees: InvestigationAssignee[]
  leadAgent: AgentLite | null
  classified: boolean
  agents: AgentLite[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

export function InvestigationAssignees({
  investigationId,
  assignees,
  leadAgent,
  classified,
  agents,
  canManage,
  onChanged,
}: InvestigationAssigneesProps) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])

  // Bereits zugewiesene Agents und die Fallführung stehen nicht erneut zur Wahl.
  const selectable = useMemo(() => {
    const taken = new Set(assignees.map((assignee) => assignee.agentId))
    if (leadAgent) taken.add(leadAgent.id)
    return agents.filter((agent) => !taken.has(agent.id))
  }, [agents, assignees, leadAgent])

  const handleAdd = async () => {
    // Einzeln absenden: so bleibt eine bereits bestehende Zuweisung ein
    // harmloser 409 und reisst die übrigen nicht mit.
    let added = 0
    for (const agentId of picked) {
      const ok = await mutate(`/api/investigations/${investigationId}/assignees`, {
        body: { agentId },
        errorTitle: 'Zuweisung fehlgeschlagen',
      })
      if (ok) added += 1
    }
    if (added > 0) {
      setPicked([])
      setOpen(false)
    }
  }

  const handleRemove = (assignee: InvestigationAssignee) =>
    mutate(`/api/investigations/assignees/${assignee.id}`, {
      method: 'DELETE',
      successTitle: 'Zuweisung entfernt',
      successMessage: `${assignee.agent.firstName} ${assignee.agent.lastName} hat keinen Zugriff mehr über diese Zuweisung.`,
      errorTitle: 'Entfernen fehlgeschlagen',
    })

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-white">Zugewiesene Ermittler</h2>
          <p className="mt-0.5 text-[11.5px] text-[#6a6a6a]">
            {classified
              ? 'Diese Agents sehen die Verschlusssache zusätzlich zu Ersteller, Fallführung und Berechtigten.'
              : 'Die Akte ist nicht vertraulich – Zuweisungen dokumentieren hier, wer ermittelt.'}
          </p>
        </div>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Zuweisen
          </Button>
        )}
      </div>

      {leadAgent && (
        <div className="mb-2 flex items-center gap-2 rounded-[9px] border border-[#2a2a2a] bg-[#111111] px-3 py-2">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#c4b5fd]" />
          <span className="text-[12.5px] text-white">
            {leadAgent.firstName} {leadAgent.lastName} ({leadAgent.badgeNumber})
          </span>
          <span className="text-[11px] text-[#6a6a6a]">Fallführung</span>
        </div>
      )}

      {assignees.length === 0 ? (
        <p className="py-2 text-[12.5px] text-[#6a6a6a]">Keine weiteren Ermittler zugewiesen.</p>
      ) : (
        <ul className="divide-y divide-[#232323]">
          {assignees.map((assignee) => (
            <li key={assignee.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-white">
                  {assignee.agent.firstName} {assignee.agent.lastName} ({assignee.agent.badgeNumber})
                  {assignee.agent.rank && (
                    <span className="ml-2 text-[11.5px] text-[#6a6a6a]">{assignee.agent.rank.name}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
                  Zugewiesen {formatDateTime(assignee.createdAt)}
                  {assignee.addedBy ? ` von ${assignee.addedBy.displayName}` : ''}
                </p>
                {!assignee.agent.discordId && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#d4a017]">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Ohne Discord-Verknüpfung – kein Zugriff auf Verschlusssachen.
                  </p>
                )}
              </div>

              {canManage && (
                <button
                  type="button"
                  onClick={() => void handleRemove(assignee)}
                  className="shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                  aria-label="Zuweisung entfernen"
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
        title="Ermittler zuweisen"
        description="Zugewiesene Agents behalten Zugriff, auch wenn die Akte zur Verschlusssache wird."
        size="lg"
      >
        <div className="space-y-4">
          <AgentPicker
            label="Agents"
            agents={selectable}
            value={picked}
            onChange={setPicked}
            disabled={saving}
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAdd} loading={saving} disabled={picked.length === 0}>
              {picked.length > 1 ? `${picked.length} Agents zuweisen` : 'Zuweisen'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

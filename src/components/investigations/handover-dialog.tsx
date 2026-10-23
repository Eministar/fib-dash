'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import type { AgentLite } from './types'

const NOTE_MAX = 5000

/**
 * Fallführung mit Übergabenotiz wechseln. Die Notiz landet in der
 * Chronologie, damit die neue Fallführung weiß, wo die Akte steht.
 */
export function HandoverDialog({
  investigationId,
  currentLead,
  agents,
  onClose,
  onDone,
}: {
  investigationId: string
  currentLead: AgentLite | null
  agents: AgentLite[]
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { execute, loading } = useApi()
  const [leadAgentId, setLeadAgentId] = useState('')
  const [note, setNote] = useState('')
  const [keepPrevious, setKeepPrevious] = useState(true)
  const [failure, setFailure] = useState('')

  const submit = async () => {
    setFailure('')
    try {
      await execute(`/api/investigations/${investigationId}/handover`, {
        method: 'POST',
        body: JSON.stringify({ leadAgentId, note, keepPreviousAsAssignee: keepPrevious }),
      })
      await onDone()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Übergabe fehlgeschlagen')
    }
  }

  return (
    <Modal
      open
      onClose={loading ? () => {} : onClose}
      title="Fallführung übergeben"
      description={currentLead
        ? `Aktuell: ${currentLead.firstName} ${currentLead.lastName} (${displayBadgeNumber(currentLead.badgeNumber)})`
        : 'Die Akte hat noch keine Fallführung.'}
      size="lg"
    >
      <div className="space-y-4">
        <Select
          label="Neue Fallführung"
          value={leadAgentId}
          onValueChange={setLeadAgentId}
          placeholder="Agent wählen …"
          options={agents
            .filter((agent) => agent.id !== currentLead?.id)
            .map((agent) => ({ value: agent.id, label: `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})` }))}
        />
        <div>
          <Textarea
            label="Übergabenotiz"
            rows={7}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Stand der Ermittlung, offene Spuren, nächste Schritte, Ansprechpartner …"
            required
          />
          <p className="mt-1 text-[11.5px] text-[#8e8e93]">Erscheint als Eintrag in der Chronologie. Die neue Fallführung wird benachrichtigt.</p>
        </div>
        {currentLead && (
          <div>
            <Checkbox
              checked={keepPrevious}
              onCheckedChange={setKeepPrevious}
              label="Bisherige Fallführung bleibt als Ermittler zugewiesen"
            />
          </div>
        )}
        {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Abbrechen</Button>
          <Button onClick={() => void submit()} loading={loading} disabled={!leadAgentId || !note.trim()}>Übergeben</Button>
        </div>
      </div>
    </Modal>
  )
}

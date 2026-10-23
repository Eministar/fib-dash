'use client'

import { useState } from 'react'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/ui/loading'
import { notifyLiveUpdate } from '@/lib/core/live-updates'
import { formatDate } from '@/lib/utils'
import type { AgentOpenTask } from '@/lib/agents/agent-open-tasks'

export function AgentOpenTasks({ agentId, onNavigate }: { agentId: string; onNavigate: (tab: string) => void }) {
  const { data, error, loading, refetch } = useFetch<AgentOpenTask[]>(`/api/agents/${agentId}/open-tasks`)
  const [failure, setFailure] = useState('')
  const [expanded, setExpanded] = useState(false)
  async function complete(task: AgentOpenTask) {
    setFailure('')
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'COMPLETED' }) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Aufgabe konnte nicht abgeschlossen werden.')
      await refetch()
      notifyLiveUpdate()
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.') }
  }
  const visible = expanded ? data : data?.slice(0, 5)
  return <section className="border-b border-[#38383a]/60 py-4" aria-label="Offene Aufgaben">
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-[13.5px] font-semibold text-[#eee]">Offene Aufgaben{data ? <span className="ml-2 font-normal tabular-nums text-[#98989d]">{data.length}</span> : null}</h2>
      {(data?.length ?? 0) > 5 && <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? 'Weniger anzeigen' : 'Alle anzeigen'}</Button>}
    </div>
    {(error || failure) && <div className="mb-3 space-y-2"><p role="alert" className="text-sm text-red-300">{error || failure}</p>{error && <Button size="sm" variant="outline" onClick={refetch}>Erneut versuchen</Button>}</div>}
    {loading && !data ? <ListSkeleton compact rows={3} /> : data?.length === 0 ? <p className="text-[13px] text-[#98989d]">Keine offenen Aufgaben in den für dich sichtbaren Bereichen.</p> : <ul className="divide-y divide-[#38383a]/40">
      {visible?.map(task => <li key={`${task.kind}-${task.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
        <div className="min-w-0 flex-1"><p className="break-words text-[13px] text-[#eee]">{task.title}</p><p className="mt-0.5 text-xs text-[#98989d]">{task.detail}{task.inProgress ? ' · In Bearbeitung' : ''}</p>
          {task.dueDate && <p className={`mt-1 text-xs ${task.overdue ? 'text-amber-300' : 'text-[#98989d]'}`}>{task.overdue ? 'Überfällig seit' : 'Fällig'}: {formatDate(task.dueDate)}</p>}
        </div>
        {task.kind !== 'task' ? <Button size="sm" variant="ghost" onClick={() => onNavigate(task.kind === 'training' ? 'career' : 'records')}>{task.kind === 'training' ? 'Zur Ausbildung' : 'Zum Vertrag'}</Button>
          : task.canComplete && <Button size="sm" variant="outline" onClick={() => complete(task)}>Erledigen</Button>}
      </li>)}
    </ul>}
  </section>
}

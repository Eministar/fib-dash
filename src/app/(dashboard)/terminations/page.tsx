'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { UserX, UserPlus, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn, formatDate } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'
import { useUrlState } from '@/hooks/use-url-state'
import { matchesSearch } from '@/lib/search-match'

interface Agent {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  rank: { name: string }
  status: string
}

interface Termination {
  id: string
  reason: string
  terminatedAt: string
  previousRank: string | null
  previousBadgeNumber: string | null
  previousFirstName: string | null
  previousLastName: string | null
  agent: {
    id: string
    firstName: string
    lastName: string
    badgeNumber: string
    status: string
    rank: { name: string; color: string }
    discordId?: string | null
    user?: { discordId: string | null } | null
  } | null
  terminatedBy: { displayName: string } | null
}

function terminationAgentNames(t: Termination): { first: string; last: string } {
  const first = t.agent?.firstName ?? t.previousFirstName ?? ''
  const last = t.agent?.lastName ?? t.previousLastName ?? ''
  return { first, last }
}

export default function TerminationsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'terminations:view')
  const canManage = hasPermission(user, 'terminations:manage')
  const { data: terminations, loading, refetch } = useFetch<Termination[]>(canView ? '/api/terminations' : null)
  const { data: agents, refetch: refetchAgents } = useFetch<Agent[]>(canManage ? '/api/agents' : null)
  const { execute } = useApi()
  const { addToast } = useToast()

  const [rehireId, setRehireId] = useState<string | null>(null)
  const [createModal, setCreateModal] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useUrlState('q', '')
  const [statusFilter, setStatusFilter] = useUrlState('status', '')

  const filteredTerminations = useMemo(() => {
    if (!terminations) return []
    return terminations.filter((t) => {
      if (statusFilter === 'open' && t.agent?.status !== 'TERMINATED') return false
      if (statusFilter === 'rehired' && (!t.agent || t.agent.status === 'TERMINATED')) return false
      if (statusFilter === 'deleted' && t.agent) return false
      const { first, last } = terminationAgentNames(t)
      return matchesSearch(search, [
        first,
        last,
        `${first} ${last}`,
        t.previousBadgeNumber,
        t.agent?.badgeNumber,
        t.previousRank ?? t.agent?.rank?.name,
        t.reason,
        t.agent?.discordId,
        t.agent?.user?.discordId,
      ])
    })
  }, [terminations, search, statusFilter])

  const activeAgents = agents?.filter(o => o.status !== 'TERMINATED') || []
  const selectedAgent = activeAgents.find(o => o.id === selectedAgentId)

  const handleCreate = async () => {
    if (!selectedAgentId || !reason.trim()) return
    try {
      await execute('/api/terminations', {
        method: 'POST',
        body: JSON.stringify({ agentId: selectedAgentId, reason }),
      })
      addToast({ type: 'success', title: 'Kündigung eingetragen' })
      setCreateModal(false)
      setSelectedAgentId('')
      setReason('')
      await refetch()
      await refetchAgents()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleRehire = async (agentId: string) => {
    try {
      const updated = await execute(`/api/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ACTIVE' }),
      }) as { badgeNumber?: string } | null
      addToast({
        type: 'success',
        title: 'Agent wiedereingestellt',
        message: updated?.badgeNumber ? `Dienstnummer: ${displayBadgeNumber(updated.badgeNumber)}` : undefined,
      })
      setRehireId(null)
      await refetch()
      await refetchAgents()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader withHeader />

  const filterClass =
    'h-[36px] sm:h-[34px] px-3 rounded-[8px] text-[13px] bg-[#1c1c1e] text-[#c7c7cc] border border-[#38383a]/50 focus:outline-none focus:border-[#d4d4d4] transition-all'

  return (
    <div>
      <PageHeader
        title="Kündigungen"
        description={`${terminations?.length || 0} Einträge`}
        action={canManage ? (
          <Button size="sm" onClick={() => setCreateModal(true)}>
            <Plus size={14} strokeWidth={2} />
            Neue Kündigung
          </Button>
        ) : undefined}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8e8e93]"
            strokeWidth={1.75}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche nach Name, Dienstnummer, Rang oder Grund..."
            className={cn(filterClass, 'w-full pl-9 placeholder:text-[#8e8e93]')}
          />
        </div>
        <Select
          size="sm"
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: '', label: 'Alle Einträge' },
            { value: 'open', label: 'Wiedereinstellbar' },
            { value: 'rehired', label: 'Wiedereingestellt' },
            { value: 'deleted', label: 'Profil gelöscht' },
          ]}
          className="sm:w-[190px]"
        />
      </div>

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        {filteredTerminations.length > 0 ? (
          <div className="divide-y divide-[#38383a]">
            {filteredTerminations.map((t, i) => {
              const { first: fn, last: ln } = terminationAgentNames(t)
              const displayName = [fn, ln].filter(Boolean).join(' ') || '—'
              const badgeDn = displayBadgeNumber(t.previousBadgeNumber || t.agent?.badgeNumber || null)
              return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-4 px-5 py-4"
              >
                <div className="h-9 w-9 rounded-[9px] bg-[#2c2c2e] flex items-center justify-center shrink-0 mt-0.5">
                  <UserX size={16} className="text-[#8e8e93]" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-[13px] font-medium text-[#eee]">
                      {displayName}
                    </p>
                    <span className="text-[11px] text-[#8e8e93] font-mono">DN: {badgeDn}</span>
                    {!t.agent && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#3a3a3c] text-[#98989d] border border-[#48484a]">
                        Profil gelöscht
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#8e8e93] mb-1">
                    Ehem. Rang: <span className="text-[#8e8e93] font-medium">{t.previousRank || t.agent?.rank?.name || '—'}</span>
                  </p>
                  <p className="text-[13px] text-[#8e8e93]">{t.reason}</p>
                  <p className="text-[11px] text-[#8e8e93] mt-1.5">
                    {formatDate(t.terminatedAt)} · von {t.terminatedBy?.displayName ?? 'Gelöscht'}
                  </p>
                </div>
                {canManage && (
                <div className="shrink-0">
                  {t.agent?.status === 'TERMINATED' ? (
                    <Button variant="secondary" size="sm" onClick={() => setRehireId(t.agent!.id)}>
                      <UserPlus size={13} strokeWidth={1.75} />
                      Wiedereinstellen
                    </Button>
                  ) : t.agent ? (
                    <span className="text-[11.5px] text-[#34d399] font-medium">Wiedereingestellt</span>
                  ) : (
                    <span className="text-[11px] text-[#8e8e93]" title="Datensatz ohne Agent-Profil">—</span>
                  )}
                </div>
                )}
              </motion.div>
            )})}
          </div>
        ) : (
          <div className="text-center py-20">
            <UserX size={28} className="mx-auto mb-3 text-[#f5f5f7]" strokeWidth={1.5} />
            <p className="text-[13px] text-[#8e8e93]">
              {terminations && terminations.length > 0 ? 'Keine Treffer für die aktuelle Suche' : 'Keine Kündigungen'}
            </p>
          </div>
        )}
      </div>

      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Neue Kündigung" size="md">
        <div className="space-y-4">
          <Select
            label="Agent auswählen"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            options={activeAgents.map(o => ({ value: o.id, label: `${displayBadgeNumber(o.badgeNumber)} – ${o.firstName} ${o.lastName} (${o.rank.name})` }))}
            placeholder="Agent wählen..."
          />
          {selectedAgent && (
            <div className="px-3 py-2.5 bg-[#2c2c2e] rounded-[8px]">
              <p className="text-[13px] text-[#98989d]">
                <span className="font-medium text-[#eee]">{selectedAgent.firstName} {selectedAgent.lastName}</span> · {selectedAgent.rank.name} · DN {displayBadgeNumber(selectedAgent.badgeNumber)}
              </p>
            </div>
          )}
          <Textarea
            label="Kündigungsgrund"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            placeholder="Grund für die Kündigung..."
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setCreateModal(false)}>Abbrechen</Button>
            <Button variant="danger" size="sm" onClick={handleCreate} disabled={!selectedAgentId || !reason.trim()}>Kündigung eintragen</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rehireId} onClose={() => setRehireId(null)} title="Agent wiedereinstellen">
        <p className="text-[13px] text-[#98989d] mb-5">
          Möchten Sie diesen Agent wirklich wiedereinstellen? Der Status wird auf &quot;Aktiv&quot; gesetzt.
          Ist die alte Dienstnummer inzwischen vergeben, wird automatisch die nächste freie Nummer zugewiesen.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRehireId(null)}>Abbrechen</Button>
          <Button size="sm" onClick={() => rehireId && handleRehire(rehireId)}>Wiedereinstellen</Button>
        </div>
      </Modal>
    </div>
  )
}

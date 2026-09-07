'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpDown, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'
import type { RankChangeVoteSummary, RankChangeVoteValue } from '@/lib/rank-change-votes'
import {
  RankChangeListCard,
  entryDirection,
  sortEntriesByRank,
  type RankChangeDirection,
  type RankChangeEntry,
  type RankChangeList,
} from '@/components/rank-changes/rank-change-list-card'

interface Rank { id: string; name: string; sortOrder: number; color: string }
interface Agent {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  rank: Rank
  rankId: string
  status: string
}

type StatusFilter = '' | 'open' | 'executed'

function actionLabel(direction: RankChangeDirection) {
  return direction === 'DEMOTION' ? 'Degradierung' : 'Beförderung'
}

export default function RankChangeListsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'rank-changes:view')
  const canManage = hasPermission(user, 'rank-changes:manage')
  const canExecute = hasPermission(user, 'rank-change-lists:execute')
  const canDeleteLists = hasPermission(user, 'rank-change-lists:delete')
  const { data: lists, loading, refetch, setData: setLists } = useFetch<RankChangeList[]>(canView ? '/api/rank-change-lists' : null)
  const { data: agents } = useFetch<Agent[]>(canManage ? '/api/agents' : null)
  const { data: ranks } = useFetch<Rank[]>(canManage ? '/api/ranks' : null)
  const { execute } = useApi()
  const { addToast } = useToast()

  const [createModal, setCreateModal] = useState(false)
  const [addEntryListId, setAddEntryListId] = useState<string | null>(null)
  const [executeEntry, setExecuteEntry] = useState<{ listId: string; entryId: string; name: string; direction: RankChangeDirection } | null>(null)
  const [undoEntry, setUndoEntry] = useState<{ listId: string; entryId: string; name: string } | null>(null)
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set())
  const [votingEntryIds, setVotingEntryIds] = useState<Set<string>>(new Set())

  const [listForm, setListForm] = useState({ name: '', description: '' })
  const [entryForm, setEntryForm] = useState({ agentId: '', proposedRankId: '', newBadgeNumber: '', note: '' })
  const [agentSearch, setAgentSearch] = useState('')

  const [search, setSearch] = useState('')
  const [directionFilter, setDirectionFilter] = useState<'' | RankChangeDirection>('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [rankFilter, setRankFilter] = useState('')
  const [submitterFilter, setSubmitterFilter] = useState('')

  const rows = useMemo(() => lists ?? [], [lists])

  const activeAgents = agents?.filter((agent) => agent.status !== 'TERMINATED') || []
  const filteredAgents = activeAgents.filter((agent) => {
    const query = agentSearch.trim().toLowerCase()
    if (!query) return true
    return (
      agent.badgeNumber.toLowerCase().includes(query) ||
      agent.firstName.toLowerCase().includes(query) ||
      agent.lastName.toLowerCase().includes(query) ||
      agent.rank.name.toLowerCase().includes(query)
    )
  })
  const selectedAgent = activeAgents.find((agent) => agent.id === entryForm.agentId)

  // Gemischte Listen: jeder Rang außer dem aktuellen ist wählbar, die Richtung
  // ergibt sich aus dem Rangvergleich.
  const getTargetRanks = () => {
    if (!selectedAgent || !ranks) return []
    return [...ranks]
      .filter((rank) => rank.id !== selectedAgent.rankId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }
  const selectedTargetRank = ranks?.find((rank) => rank.id === entryForm.proposedRankId)
  const entryDirectionPreview: RankChangeDirection | null = selectedAgent && selectedTargetRank
    ? (selectedTargetRank.sortOrder > selectedAgent.rank.sortOrder ? 'DEMOTION' : 'PROMOTION')
    : null

  // Ränge und Einreicher für die Filter-Dropdowns aus den vorhandenen Einträgen ableiten.
  const { rankOptions, submitterOptions } = useMemo(() => {
    const rankMap = new Map<string, { id: string; name: string; sortOrder: number }>()
    const submitterMap = new Map<string, string>()
    for (const list of rows) {
      for (const entry of list.entries) {
        for (const rank of [entry.currentRank, entry.proposedRank]) {
          if (rank.id && !rankMap.has(rank.id)) rankMap.set(rank.id, { id: rank.id, name: rank.name, sortOrder: rank.sortOrder })
        }
        if (entry.createdBy) submitterMap.set(entry.createdBy.id, entry.createdBy.displayName)
      }
    }
    return {
      rankOptions: [...rankMap.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((rank) => ({ value: rank.id, label: rank.name })),
      submitterOptions: [...submitterMap.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'de')),
    }
  }, [rows])

  const filterActive = Boolean(search.trim() || directionFilter || statusFilter || rankFilter || submitterFilter)

  const matchesFilters = useMemo(() => (entry: RankChangeEntry) => {
    if (directionFilter && entryDirection(entry) !== directionFilter) return false
    if (statusFilter === 'open' && entry.executed) return false
    if (statusFilter === 'executed' && !entry.executed) return false
    if (rankFilter && entry.currentRank.id !== rankFilter && entry.proposedRank.id !== rankFilter) return false
    if (submitterFilter && entry.createdBy?.id !== submitterFilter) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    const haystack = [
      entry.agent.firstName,
      entry.agent.lastName,
      entry.agent.badgeNumber,
      entry.newBadgeNumber ?? '',
      entry.currentRank.name,
      entry.proposedRank.name,
      entry.note ?? '',
      entry.createdBy?.displayName ?? '',
      entry.executedBy?.displayName ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(query)
  }, [directionFilter, statusFilter, rankFilter, submitterFilter, search])

  const visibleLists = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows
      .map((list) => {
        const matchingEntries = sortEntriesByRank(list.entries.filter(matchesFilters))
        // Ein Treffer im Listennamen hält die Liste sichtbar, auch wenn kein Eintrag passt.
        const listNameMatches = Boolean(query) && list.name.toLowerCase().includes(query)
        return { list, entries: matchingEntries, listNameMatches }
      })
      .filter(({ entries, listNameMatches }) => !filterActive || entries.length > 0 || listNameMatches)
  }, [rows, matchesFilters, filterActive, search])

  const resetFilters = () => {
    setSearch('')
    setDirectionFilter('')
    setStatusFilter('')
    setRankFilter('')
    setSubmitterFilter('')
  }

  const openCreateModal = () => {
    setListForm({ name: '', description: '' })
    setCreateModal(true)
  }

  const toggleExpand = (id: string) => {
    setExpandedLists((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateList = async () => {
    if (!listForm.name.trim()) return
    try {
      const result = await execute('/api/rank-change-lists', {
        method: 'POST',
        body: JSON.stringify(listForm),
      })
      addToast({ type: 'success', title: 'Liste erstellt' })
      setCreateModal(false)
      setListForm({ name: '', description: '' })
      const created = result as { id: string } | null
      if (created) setExpandedLists((prev) => new Set([...prev, created.id]))
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDeleteList = async (id: string) => {
    try {
      await execute(`/api/rank-change-lists/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Liste gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleToggleSubmissions = async (list: RankChangeList) => {
    const closing = !list.submissionsClosed
    try {
      await execute(`/api/rank-change-lists/${list.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ submissionsClosed: closing }),
      })
      addToast({ type: 'success', title: closing ? 'Einreichungen geschlossen' : 'Einreichungen wieder geöffnet' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleAddEntry = async () => {
    if (!addEntryListId || !entryForm.agentId || !entryForm.proposedRankId) return
    try {
      await execute(`/api/rank-change-lists/${addEntryListId}/entries`, {
        method: 'POST',
        body: JSON.stringify(entryForm),
      })
      addToast({ type: 'success', title: 'Agent hinzugefügt' })
      setAddEntryListId(null)
      setEntryForm({ agentId: '', proposedRankId: '', newBadgeNumber: '', note: '' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleRemoveEntry = async (listId: string, entryId: string) => {
    try {
      await execute(`/api/rank-change-lists/${listId}/entries`, {
        method: 'DELETE',
        body: JSON.stringify({ entryId }),
      })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleVote = async (listId: string, entry: RankChangeEntry, vote: RankChangeVoteValue) => {
    if (votingEntryIds.has(entry.id)) return
    const nextVote = entry.voteSummary.currentUserVote === vote ? null : vote
    setVotingEntryIds((current) => new Set(current).add(entry.id))

    try {
      const summary = await execute(`/api/rank-change-lists/${listId}/entries/${entry.id}/vote`, {
        method: 'PATCH',
        body: JSON.stringify({ vote: nextVote }),
      }) as RankChangeVoteSummary | null

      if (summary) {
        setLists((current) => current?.map((list) => (
          list.id !== listId
            ? list
            : {
                ...list,
                entries: list.entries.map((row) => row.id === entry.id ? { ...row, voteSummary: summary } : row),
              }
        )) ?? null)
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Abstimmung fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setVotingEntryIds((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }

  const handleExecuteEntry = async () => {
    if (!executeEntry) return
    try {
      const result = await execute(`/api/rank-change-lists/${executeEntry.listId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ entryId: executeEntry.entryId }),
      }) as { executed: number } | null
      addToast({ type: 'success', title: `${result?.executed ?? 0} ${actionLabel(executeEntry.direction)} durchgeführt` })
      setExecuteEntry(null)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleUndoEntry = async () => {
    if (!undoEntry) return
    try {
      await execute(`/api/rank-change-lists/${undoEntry.listId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ entryId: undoEntry.entryId, action: 'undo' }),
      })
      addToast({ type: 'success', title: 'Beförderung rückgängig gemacht' })
      setUndoEntry(null)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  const allEntries = rows.flatMap((list) => list.entries)
  const promotionEntries = allEntries.filter((entry) => entryDirection(entry) === 'PROMOTION').length
  const demotionEntries = allEntries.length - promotionEntries
  const executedEntries = allEntries.filter((entry) => entry.executed).length
  const pendingEntries = allEntries.length - executedEntries
  const visibleEntryCount = visibleLists.reduce((sum, { entries }) => sum + entries.length, 0)

  return (
    <div>
      <PageHeader
        title="Up-/D-Rank-Listen"
        description="Beförderungen und Degradierungen werden gemeinsam in einer Liste geführt und nach Rang sortiert."
        action={canManage ? (
          <Button size="sm" onClick={openCreateModal}>
            <Plus size={14} strokeWidth={2} />
            Neue Liste
          </Button>
        ) : undefined}
      />

      {rows.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <RankChangeStat label="Up-Ranks" value={promotionEntries} tone="text-[#34d399]" />
          <RankChangeStat label="D-Ranks" value={demotionEntries} tone="text-[#f87171]" />
          <RankChangeStat label="Durchgeführt" value={executedEntries} tone="text-[#e5e5e5]" />
          <RankChangeStat label="Offen" value={pendingEntries} tone="text-[#fbbf24]" />
        </div>
      )}

      {rows.length > 0 && (
        <div className="glass-panel-elevated mb-4 rounded-[14px] border border-[#373737]/45 p-3.5">
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#808080]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, DN, Rang, Notiz..."
                className="h-[38px] w-full rounded-[8px] border border-[#343434]/70 bg-[#181818] pl-9 pr-3 text-[13.5px] text-[#f4f4f4] placeholder:text-[#808080] transition-all duration-150 focus:border-[#d4d4d4] focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)] focus:outline-none"
              />
            </div>
            <Select
              value={directionFilter}
              onValueChange={(value) => setDirectionFilter(value as '' | RankChangeDirection)}
              placeholder="Alle Typen"
              options={[
                { value: '', label: 'Alle Typen' },
                { value: 'PROMOTION', label: 'Up-Rank' },
                { value: 'DEMOTION', label: 'D-Rank' },
              ]}
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              placeholder="Alle Status"
              options={[
                { value: '', label: 'Alle Status' },
                { value: 'open', label: 'Offen' },
                { value: 'executed', label: 'Durchgeführt' },
              ]}
            />
            <Select
              value={rankFilter}
              onValueChange={setRankFilter}
              placeholder="Alle Ränge"
              options={[{ value: '', label: 'Alle Ränge' }, ...rankOptions]}
            />
            <Select
              value={submitterFilter}
              onValueChange={setSubmitterFilter}
              placeholder="Alle Einreicher"
              options={[{ value: '', label: 'Alle Einreicher' }, ...submitterOptions]}
            />
          </div>
          {filterActive && (
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="text-[11.5px] text-[#a6a6a6]">
                {visibleEntryCount} von {allEntries.length} Einträgen · {visibleLists.length} Liste{visibleLists.length === 1 ? '' : 'n'}
              </p>
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11.5px] font-semibold text-[#a6a6a6] transition-colors hover:bg-[#212121] hover:text-white"
              >
                <X size={12} /> Filter zurücksetzen
              </button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-16 text-center">
          <div className="mb-3 inline-flex rounded-full bg-[#d4d4d4]/10 p-4">
            <ArrowUpDown size={26} className="text-[#d4d4d4]" />
          </div>
          <p className="mb-1 text-[14px] font-semibold text-white">Noch keine Rangänderungslisten</p>
          <p className="mb-4 text-[12.5px] text-[#a6a6a6]">Erstelle eine Liste für Up- und D-Ranks.</p>
          {canManage && (
            <Button size="sm" onClick={openCreateModal}>
              <Plus size={13} />
              Erste Liste erstellen
            </Button>
          )}
        </div>
      )}

      {rows.length > 0 && visibleLists.length === 0 && (
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-12 text-center">
          <p className="mb-1 text-[13.5px] font-semibold text-white">Keine Treffer</p>
          <p className="mb-4 text-[12.5px] text-[#a6a6a6]">Keine Einträge passen zu Suche und Filter.</p>
          <Button size="sm" variant="secondary" onClick={resetFilters}>Filter zurücksetzen</Button>
        </div>
      )}

      <div className="space-y-3">
        {visibleLists.map(({ list, entries }, index) => (
          <motion.div
            key={list.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
          >
            <RankChangeListCard
              list={list}
              entries={entries}
              filtered={filterActive}
              // Bei aktiver Suche/Filterung werden Treffer direkt aufgeklappt.
              expanded={filterActive || expandedLists.has(list.id)}
              onToggle={() => toggleExpand(list.id)}
              canExecute={canExecute}
              canManage={canManage}
              canDelete={canDeleteLists}
              onExecute={(entry) => setExecuteEntry({
                listId: list.id,
                entryId: entry.id,
                name: `${entry.agent.firstName} ${entry.agent.lastName}`,
                direction: entryDirection(entry),
              })}
              onUndo={(entry) => setUndoEntry({ listId: list.id, entryId: entry.id, name: `${entry.agent.firstName} ${entry.agent.lastName}` })}
              onRemove={(entryId) => handleRemoveEntry(list.id, entryId)}
              onAddEntry={() => {
                setEntryForm({ agentId: '', proposedRankId: '', newBadgeNumber: '', note: '' })
                setAgentSearch('')
                setAddEntryListId(list.id)
              }}
              onToggleSubmissions={() => handleToggleSubmissions(list)}
              onDelete={() => handleDeleteList(list.id)}
              onVote={(entry, vote) => handleVote(list.id, entry, vote)}
              votingEntryIds={votingEntryIds}
            />
          </motion.div>
        ))}
      </div>

      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Neue Rangänderungsliste" size="sm">
        <div className="space-y-4">
          <Input
            label="Name"
            value={listForm.name}
            onChange={(event) => setListForm({ ...listForm, name: event.target.value })}
            required
            placeholder="z.B. Rangänderungen Juli 2026"
          />
          <p className="text-[12px] text-[#a6a6a6]">
            Up-Ranks und D-Ranks kommen in dieselbe Liste — die Richtung ergibt sich automatisch aus dem gewählten Zielrang.
          </p>
          <Textarea
            label="Beschreibung (optional)"
            value={listForm.description}
            onChange={(event) => setListForm({ ...listForm, description: event.target.value })}
            rows={2}
            placeholder="Optional"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setCreateModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleCreateList} disabled={!listForm.name.trim()}>Erstellen</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!addEntryListId} onClose={() => setAddEntryListId(null)} title="Agent zur Rangänderungsliste hinzufügen" size="md">
        <div className="space-y-4">
          <Input
            label="Agent suchen"
            value={agentSearch}
            onChange={(event) => setAgentSearch(event.target.value)}
            placeholder="Name, DN oder Rang..."
          />
          <Select
            label="Agent auswählen"
            value={entryForm.agentId}
            onChange={(event) => setEntryForm({ ...entryForm, agentId: event.target.value, proposedRankId: '' })}
            options={filteredAgents.map((agent) => ({
              value: agent.id,
              label: `${displayBadgeNumber(agent.badgeNumber)} – ${agent.firstName} ${agent.lastName} (${agent.rank.name})`,
            }))}
            placeholder={filteredAgents.length > 0 ? 'Agent wählen...' : 'Keine Treffer'}
            disabled={filteredAgents.length === 0}
          />
          {selectedAgent && (
            <>
              <div className="rounded-[8px] bg-[#212121] px-3 py-2.5">
                <p className="text-[13px] text-[#888]">
                  Aktueller Rang: <strong className="text-[#eee]">{selectedAgent.rank.name}</strong>
                </p>
              </div>
              <Select
                label="Neuer Rang"
                value={entryForm.proposedRankId}
                onChange={(event) => setEntryForm({ ...entryForm, proposedRankId: event.target.value })}
                options={getTargetRanks().map((rank) => ({
                  value: rank.id,
                  label: `${rank.name} — ${rank.sortOrder > selectedAgent.rank.sortOrder ? 'D-Rank' : 'Up-Rank'}`,
                }))}
                placeholder="Rang wählen..."
              />
              {entryDirectionPreview && (
                <p className={`text-[12px] ${entryDirectionPreview === 'DEMOTION' ? 'text-[#f87171]' : 'text-[#34d399]'}`}>
                  Wird als {entryDirectionPreview === 'DEMOTION' ? 'Degradierung (D-Rank)' : 'Beförderung (Up-Rank)'} eingetragen.
                </p>
              )}
              <Input
                label="Neue DN (optional)"
                numericOnly
                value={entryForm.newBadgeNumber}
                onChange={(event) => setEntryForm({ ...entryForm, newBadgeNumber: event.target.value })}
                placeholder={`Aktuell: ${displayBadgeNumber(selectedAgent.badgeNumber)}`}
              />
              <Input
                label={entryDirectionPreview === 'DEMOTION' ? 'Grund (optional)' : 'Notiz (optional)'}
                value={entryForm.note}
                onChange={(event) => setEntryForm({ ...entryForm, note: event.target.value })}
                placeholder={entryDirectionPreview === 'DEMOTION' ? 'Grund für D-Rank...' : 'Optional'}
              />
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setAddEntryListId(null)}>Abbrechen</Button>
            <Button size="sm" onClick={handleAddEntry} disabled={!entryForm.agentId || !entryForm.proposedRankId}>Hinzufügen</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!executeEntry} onClose={() => setExecuteEntry(null)} title={`${executeEntry ? actionLabel(executeEntry.direction) : 'Rangänderung'} ausführen`}>
        <p className="mb-5 text-[13px] text-[#888]">
          Die Rangänderung für {executeEntry?.name} wird jetzt durchgeführt. Rang und Dienstnummer werden sofort geändert. Fortfahren?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setExecuteEntry(null)}>Abbrechen</Button>
          <Button size="sm" variant={executeEntry?.direction === 'DEMOTION' ? 'danger' : 'primary'} onClick={handleExecuteEntry}>Durchführen</Button>
        </div>
      </Modal>

      <Modal open={!!undoEntry} onClose={() => setUndoEntry(null)} title="Beförderung rückgängig machen">
        <p className="mb-5 text-[13px] text-[#888]">
          Die Beförderung für {undoEntry?.name} wird zurückgesetzt. Rang und Dienstnummer werden auf den Stand vor der Durchführung gesetzt. Fortfahren?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setUndoEntry(null)}>Abbrechen</Button>
          <Button variant="danger" size="sm" onClick={handleUndoEntry}>Rückgängig machen</Button>
        </div>
      </Modal>
    </div>
  )
}

function RankChangeStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="glass-panel-elevated rounded-[12px] border border-[#373737]/45 p-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#a6a6a6]">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

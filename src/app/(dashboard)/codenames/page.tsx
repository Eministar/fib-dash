'use client'

import { displayBadgeNumber } from '@/lib/agents/badge-number'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, RefreshCw, KeyRound, History, UserPlus, Unlock, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { TabBar } from '@/components/ui/tab-bar'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { useToast } from '@/components/ui/toast'
import { AgentPicker } from '@/components/investigations/agent-picker'
import type { AgentLite } from '@/components/investigations/types'
import { CodenameHistory } from '@/components/codenames/codename-history'
import { useUrlState } from '@/hooks/use-url-state'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ListSkeleton } from '@/components/ui/loading'

type Codename = { id: string; name: string; category: string | null; retired: boolean; retiredReason: string | null; currentAgent: AgentLite | null; _count?: { assignments: number } }
type Catalog = { items: Codename[]; total: number; prefix: string; categories?: string[] }
type Dialog = { kind: 'create' } | { kind: 'edit' | 'assign' | 'release' | 'history' | 'delete'; entry: Codename }
type Tab = 'catalog' | 'assignments'
type Status = '' | 'free' | 'assigned' | 'retired'

const PAGE_SIZE = 30
const TABS = [{ id: 'catalog', label: 'Katalog' }, { id: 'assignments', label: 'Aktuelle Belegung' }]

function codenameLabel(prefix: string | undefined, name: string) {
  return [prefix, name].filter(Boolean).join(' ')
}

export default function CodenamesPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const canView = hasPermission(user, 'codenames:view')
  const canManage = hasPermission(user, 'codenames:manage')
  const canSettings = hasPermission(user, 'settings:manage')
  const canViewAgents = hasPermission(user, 'agents:view')
  const [tab, setTab] = useUrlState<Tab>('tab', 'catalog', ['catalog', 'assignments'])
  const [search, setSearch] = useUrlState('q', '')
  const debouncedSearch = useDebouncedValue(search)
  const [status, setStatus] = useUrlState<Status>('status', '', ['', 'free', 'assigned', 'retired'])
  const [category, setCategory] = useUrlState('category', '')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { execute, loading: syncing } = useApi()
  const query = new URLSearchParams({ search: debouncedSearch, page: String(page), pageSize: String(PAGE_SIZE) })
  if (tab === 'catalog' && status) query.set('status', status)
  if (tab === 'catalog' && category) query.set('category', category)
  const { data, loading, error, refetch } = useFetch<Catalog>(canView ? `/api/codenames${tab === 'assignments' ? '/assignments' : ''}?${query}` : null)
  if (!canView) return <UnauthorizedContent />

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const syncBoard = async () => {
    try {
      await execute('/api/codenames/board/sync', { method: 'POST' })
      addToast({ type: 'success', title: 'Discord-Board aktualisiert' })
    } catch (cause) {
      addToast({ type: 'error', title: 'Synchronisierung fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return <div>
    <PageHeader title="Decknamen" eyebrow="FIB · Identitäten" description="Decknamen vergeben, Belegung einsehen und frühere Zuweisungen nachvollziehen." action={<>
      {canSettings && <Button variant="outline" loading={syncing} onClick={() => void syncBoard()}><RefreshCw size={15} />Board aktualisieren</Button>}
      {canManage && <Button onClick={() => setDialog({ kind: 'create' })}><Plus size={16} />Deckname anlegen</Button>}
    </>} />
    <TabBar label="Decknamenansicht" active={tab} tabs={TABS} onSelect={(value) => { setTab(value as Tab); setPage(1) }} />
    <div role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label} className="glass-panel rounded-xl p-4 sm:p-5">
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Input label="Suche" type="search" placeholder="Deckname suchen …" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        {tab === 'catalog' && <>
          <Select label="Status" value={status} onValueChange={value => { setStatus(value as Status); setPage(1) }} options={[{ value: '', label: 'Alle Status' }, { value: 'free', label: 'Frei' }, { value: 'assigned', label: 'Vergeben' }, { value: 'retired', label: 'Gesperrt' }]} />
          <Select label="Kategorie" value={category} onValueChange={value => { setCategory(value); setPage(1) }} options={[{ value: '', label: 'Alle Kategorien' }, ...(data?.categories ?? []).map(value => ({ value, label: value }))]} />
        </>}
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-[#fca5a5]">{error} <Button variant="ghost" onClick={() => void refetch()}>Erneut laden</Button></p>}
      {loading && !data ? <ListSkeleton /> : !data?.items.length ? (
        <div className="py-12 text-center">
          <KeyRound className="mx-auto mb-3 text-[#8e8e93]" aria-hidden />
          <p className="text-sm text-[#98989d]">Keine Decknamen gefunden.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#38383a]/60">
          {data.items.map(entry => <CodenameRow
            key={entry.id}
            entry={entry}
            prefix={data.prefix}
            canManage={canManage}
            canViewAgents={canViewAgents}
            onOpen={(kind) => setDialog({ kind, entry })}
          />)}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#38383a]/60 pt-4">
        <span className="text-xs text-[#8e8e93]">{data?.total ?? 0} Decknamen{pageCount > 1 && ` · Seite ${page} / ${pageCount}`}</span>
        {pageCount > 1 && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}>Weiter</Button>
        </div>}
      </div>
    </div>
    {dialog && <CodenameDialog dialog={dialog} prefix={data?.prefix} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void refetch() }} />}
  </div>
}

function CodenameStatus({ entry }: { entry: Codename }) {
  if (entry.retired) return <Badge variant="danger">Gesperrt</Badge>
  if (entry.currentAgent) return <Badge className="border-[#a78bfa]/30 bg-[#161225]/80 text-[#c4b5fd]">Vergeben</Badge>
  return <Badge variant="success">Frei</Badge>
}

function CodenameRow({ entry, prefix, canManage, canViewAgents, onOpen }: {
  entry: Codename
  prefix: string
  canManage: boolean
  canViewAgents: boolean
  onOpen: (kind: Exclude<Dialog['kind'], 'create'>) => void
}) {
  const agent = entry.currentAgent
  const canAssign = canManage && !entry.retired
  const menuItems: ActionMenuItem[] = [
    ...(canAssign ? [{ id: 'history', label: 'Historie', icon: History, onSelect: () => onOpen('history') }] : []),
    ...(canManage && agent ? [{ id: 'release', label: 'Freigeben', icon: Unlock, onSelect: () => onOpen('release') }] : []),
    ...(canManage ? [{ id: 'edit', label: 'Bearbeiten', icon: Pencil, onSelect: () => onOpen('edit') }] : []),
    ...(canManage && entry._count?.assignments === 0 && !agent ? [{ id: 'delete', label: 'Löschen', icon: Trash2, danger: true, onSelect: () => onOpen('delete') }] : []),
  ]

  return <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.3fr)_7rem_minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0">
      <p className="truncate font-medium text-white">{codenameLabel(prefix, entry.name)}</p>
      <p className="mt-1 text-xs text-[#8e8e93]">{entry.category ?? 'Ohne Kategorie'}</p>
      {entry.retiredReason && <p className="mt-1 max-w-xs text-xs text-[#fca5a5]">{entry.retiredReason}</p>}
    </div>
    <div className="justify-self-end sm:justify-self-start"><CodenameStatus entry={entry} /></div>
    <div className="min-w-0 text-sm text-[#98989d]">
      {agent ? <>
        <p className="truncate">{canViewAgents ? <Link className="hover:text-white" href={`/agents/${agent.id}`}>{agent.firstName} {agent.lastName}</Link> : `${agent.firstName} ${agent.lastName}`}</p>
        <p className="text-xs text-[#8e8e93]">{displayBadgeNumber(agent.badgeNumber)}</p>
      </> : <span className="hidden sm:inline">—</span>}
    </div>
    <div className="flex items-center justify-end gap-1.5">
      {canAssign
        ? <Button size="sm" variant="outline" onClick={() => onOpen('assign')}><UserPlus size={14} aria-hidden />{agent ? 'Neu zuweisen' : 'Zuweisen'}</Button>
        : <Button size="sm" variant="ghost" onClick={() => onOpen('history')}><History size={14} aria-hidden />Historie</Button>}
      <ActionMenu items={menuItems} label={`Weitere Aktionen für ${codenameLabel(prefix, entry.name)}`} />
    </div>
  </li>
}

function CodenameDialog({ dialog, prefix, onClose, onSaved }: { dialog: Dialog; prefix?: string; onClose: () => void; onSaved: () => void }) {
  const entry = 'entry' in dialog ? dialog.entry : null
  const [name, setName] = useState(entry?.name ?? '')
  const [category, setCategory] = useState(entry?.category ?? '')
  const [retired, setRetired] = useState(entry?.retired ?? false)
  const [reason, setReason] = useState(entry?.retiredReason ?? '')
  const [note, setNote] = useState('')
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [force, setForce] = useState(false)
  const [failure, setFailure] = useState('')
  const { execute, loading } = useApi()
  const agents = useFetch<AgentLite[]>(dialog.kind === 'assign' ? '/api/agents' : null)
  const titles = { create: 'Deckname anlegen', edit: 'Deckname bearbeiten', assign: 'Deckname zuweisen', release: 'Deckname freigeben', history: 'Trägerhistorie', delete: 'Deckname löschen' }
  const entryLabel = entry ? codenameLabel(prefix, entry.name) : ''
  const save = async () => {
    setFailure('')
    try {
      const base = entry ? `/api/codenames/${entry.id}` : '/api/codenames'
      const kind = dialog.kind
      const url = ['assign', 'release'].includes(kind) ? `${base}/${kind}` : base
      const body = kind === 'assign' ? { agentId: agentIds[0], note, force } : kind === 'release' ? { retire: retired, note } : kind === 'edit' ? { name, category: category || null, retired, retiredReason: reason || null } : { name, category: category || null }
      await execute(url, { method: kind === 'delete' ? 'DELETE' : kind === 'edit' ? 'PATCH' : 'POST', ...(kind === 'delete' ? {} : { body: JSON.stringify(body) }) })
      onSaved()
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen') }
  }
  return <Modal open onClose={loading ? () => {} : onClose} title={`${titles[dialog.kind]}${entry ? ` · ${entryLabel}` : ''}`} size="lg">
    {dialog.kind === 'history' ? <CodenameHistory codenameId={entry!.id} /> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      {['create', 'edit'].includes(dialog.kind) && <>
        <Input label="Name ohne Präfix" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
        <Input label="Kategorie" value={category} onChange={e => setCategory(e.target.value)} maxLength={40} />
      </>}
      {dialog.kind === 'assign' && <>
        {agents.error && <p role="alert" className="text-sm text-[#fca5a5]">{agents.error}</p>}
        <AgentPicker single warnUnlinked={false} label="Agent" description="Ein vorhandener Deckname des gewählten Agents wird bei der Zuweisung freigegeben." agents={agents.data ?? []} value={agentIds} onChange={setAgentIds} disabled={loading || agents.loading} />
        {entry?.currentAgent && <>
          <p className="text-sm text-[#fbbf24]">Aktuell vergeben an {entry.currentAgent.firstName} {entry.currentAgent.lastName} ({displayBadgeNumber(entry.currentAgent.badgeNumber)}).</p>
          <Checkbox checked={force} onCheckedChange={setForce} label="Bestehenden Träger ablösen" />
        </>}
      </>}
      {['assign', 'release'].includes(dialog.kind) && <Textarea label="Notiz (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={5000} />}
      {['edit', 'release'].includes(dialog.kind) && <Checkbox checked={retired} onCheckedChange={setRetired} label="Deckname sperren und eine bestehende Zuweisung beenden" />}
      {dialog.kind === 'edit' && retired && <Input label="Sperrgrund" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} />}
      {dialog.kind === 'release' && <p className="text-sm text-[#98989d]">Die Zuweisung wird beendet. Ohne Sperre ist der Deckname sofort wieder verfügbar.</p>}
      {dialog.kind === 'delete' && <p className="text-sm text-[#98989d]">„{entryLabel}“ endgültig aus dem Katalog entfernen?</p>}
      {failure && <p role="alert" className="text-sm text-[#fca5a5]">{failure}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button>
        <Button type="submit" variant={dialog.kind === 'delete' ? 'danger' : 'primary'} loading={loading} disabled={dialog.kind === 'assign' && (!agentIds.length || !!agents.error)}>{dialog.kind === 'delete' ? 'Endgültig löschen' : dialog.kind === 'assign' ? 'Zuweisen' : dialog.kind === 'release' ? 'Freigeben' : 'Speichern'}</Button>
      </div>
    </form>}
  </Modal>
}

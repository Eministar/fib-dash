'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, RefreshCw, KeyRound } from 'lucide-react'
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
import { Modal } from '@/components/ui/modal'
import { AgentPicker } from '@/components/investigations/agent-picker'
import type { AgentLite } from '@/components/investigations/types'
import { CodenameHistory } from '@/components/codenames/codename-history'

type Codename = { id: string; name: string; category: string | null; retired: boolean; retiredReason: string | null; currentAgent: AgentLite | null; _count?: { assignments: number } }
type Catalog = { items: Codename[]; total: number; prefix: string; categories?: string[] }
type Dialog = { kind: 'create' } | { kind: 'edit' | 'assign' | 'release' | 'history' | 'delete'; entry: Codename }

export default function CodenamesPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'codenames:view')
  const canManage = hasPermission(user, 'codenames:manage')
  const canSettings = hasPermission(user, 'settings:manage')
  const [tab, setTab] = useState('catalog')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState('')
  const { execute, loading: syncing } = useApi()
  const query = new URLSearchParams({ search, page: String(page), pageSize: '30' })
  if (tab === 'catalog' && status) query.set('status', status)
  if (tab === 'catalog' && category) query.set('category', category)
  const { data, loading, error, refetch } = useFetch<Catalog>(canView ? `/api/codenames${tab === 'assignments' ? '/assignments' : ''}?${query}` : null)
  const label = (entry: Codename) => [data?.prefix, entry.name].filter(Boolean).join(' ')
  if (!canView) return <UnauthorizedContent />

  return <div>
    <PageHeader title="Decknamen" eyebrow="FIB · Identitäten" description="Decknamen vergeben, Belegung einsehen und frühere Zuweisungen nachvollziehen." action={<>
      {canSettings && <Button variant="outline" loading={syncing} onClick={async () => { try { await execute('/api/codenames/board/sync', { method: 'POST' }); setNotice('Discord-Board aktualisiert.') } catch (e) { setNotice(e instanceof Error ? e.message : 'Synchronisierung fehlgeschlagen') } }}><RefreshCw size={15} />Board aktualisieren</Button>}
      {canManage && <Button onClick={() => setDialog({ kind: 'create' })}><Plus size={16} />Deckname anlegen</Button>}
    </>} />
    {notice && <p role="status" className="mb-4 text-sm text-[#d4d4d4]">{notice}</p>}
    <div className="mb-4 flex gap-2" role="tablist" aria-label="Decknamenansicht">
      {[['catalog', 'Katalog'], ['assignments', 'Aktuelle Belegung']].map(([value, text]) => <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? 'primary' : 'ghost'} onClick={() => { setTab(value); setPage(1) }}>{text}</Button>)}
    </div>
    <div className="glass-panel rounded-xl p-4 sm:p-5">
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Input label="Suche" placeholder="Deckname suchen …" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        {tab === 'catalog' && <><Select label="Status" value={status} onValueChange={value => { setStatus(value); setPage(1) }} options={[{ value: '', label: 'Alle Status' }, { value: 'free', label: 'Frei' }, { value: 'assigned', label: 'Vergeben' }, { value: 'retired', label: 'Gesperrt' }]} /><Select label="Kategorie" value={category} onValueChange={value => { setCategory(value); setPage(1) }} options={[{ value: '', label: 'Alle Kategorien' }, ...(data?.categories ?? []).map(value => ({ value, label: value }))]} /></>}
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-300">{error} <Button variant="ghost" onClick={() => void refetch()}>Erneut laden</Button></p>}
      {loading ? <p className="py-10 text-center text-sm text-[#909090]">Decknamen werden geladen …</p> : !data?.items.length ? <div className="py-12 text-center"><KeyRound className="mx-auto mb-3 text-[#909090]" /><p className="text-sm text-[#a6a6a6]">Keine Decknamen gefunden.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-[#909090]"><tr><th className="pb-3">Deckname / Kategorie</th><th className="pb-3">Status</th><th className="pb-3">Aktueller Träger</th><th className="pb-3 text-right">Aktionen</th></tr></thead><tbody>
        {data.items.map(entry => <tr key={entry.id} className="border-t border-[#343434]/60"><td className="py-4 pr-4"><span className="font-medium text-white">{label(entry)}</span><p className="mt-1 text-xs text-[#909090]">{entry.category ?? 'Ohne Kategorie'}</p>{entry.retiredReason && <p className="mt-1 max-w-xs text-xs text-red-300">{entry.retiredReason}</p>}</td><td className="pr-4"><span className={`rounded-md px-2 py-1 text-xs ${entry.retired ? 'bg-red-500/10 text-red-300' : entry.currentAgent ? 'bg-violet-500/10 text-violet-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{entry.retired ? 'Gesperrt' : entry.currentAgent ? 'Vergeben' : 'Frei'}</span></td><td className="pr-4 text-[#a6a6a6]">{entry.currentAgent ? <><p>{hasPermission(user, 'agents:view') ? <Link className="hover:text-white" href={`/agents/${entry.currentAgent.id}`}>{entry.currentAgent.firstName} {entry.currentAgent.lastName}</Link> : `${entry.currentAgent.firstName} ${entry.currentAgent.lastName}`}</p><p className="text-xs text-[#909090]">{entry.currentAgent.badgeNumber}</p></> : '—'}</td><td className="py-3"><div className="flex flex-wrap justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'history', entry })}>Historie</Button>{canManage && <>{!entry.retired && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'assign', entry })}>{entry.currentAgent ? 'Neu zuweisen' : 'Zuweisen'}</Button>}{entry.currentAgent && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'release', entry })}>Freigeben</Button>}<Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', entry })}>Bearbeiten</Button>{entry._count?.assignments === 0 && !entry.currentAgent && <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'delete', entry })}>Löschen</Button>}</>}</div></td></tr>)}
      </tbody></table></div>}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#343434]/60 pt-4"><span className="text-xs text-[#909090]">{data?.total ?? 0} Decknamen · Seite {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 30))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button variant="outline" size="sm" disabled={page * 30 >= (data?.total ?? 0) || loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>
    </div>
    {dialog && <CodenameDialog dialog={dialog} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void refetch() }} />}
  </div>
}

function CodenameDialog({ dialog, onClose, onSaved }: { dialog: Dialog; onClose: () => void; onSaved: () => void }) {
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
  return <Modal open onClose={loading ? () => {} : onClose} title={`${titles[dialog.kind]}${entry ? ` · ${entry.name}` : ''}`} size="lg">
    {dialog.kind === 'history' ? <CodenameHistory codenameId={entry!.id} /> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      {['create', 'edit'].includes(dialog.kind) && <><Input label="Name ohne Präfix" value={name} onChange={e => setName(e.target.value)} required maxLength={80} /><Input label="Kategorie" value={category} onChange={e => setCategory(e.target.value)} maxLength={40} /></>}
      {dialog.kind === 'assign' && <>{agents.error && <p role="alert" className="text-sm text-red-300">{agents.error}</p>}<AgentPicker single warnUnlinked={false} label="Agent" description="Ein vorhandener Deckname des gewählten Agents wird bei der Zuweisung freigegeben." agents={agents.data ?? []} value={agentIds} onChange={setAgentIds} disabled={loading || agents.loading} />{entry?.currentAgent && <p className="text-sm text-amber-200">Aktuell vergeben an {entry.currentAgent.firstName} {entry.currentAgent.lastName} ({entry.currentAgent.badgeNumber}).</p>}<label className="flex items-start gap-2 text-sm text-[#a6a6a6]"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Bestehenden Träger ablösen, falls der Deckname bereits vergeben ist.</label></>}
      {['assign', 'release'].includes(dialog.kind) && <Textarea label="Notiz (optional)" value={note} onChange={e => setNote(e.target.value)} maxLength={5000} />}
      {['edit', 'release'].includes(dialog.kind) && <label className="flex items-start gap-2 text-sm text-[#a6a6a6]"><input type="checkbox" checked={retired} onChange={e => setRetired(e.target.checked)} />Deckname sperren und eine bestehende Zuweisung beenden.</label>}
      {dialog.kind === 'edit' && retired && <Input label="Sperrgrund" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} />}
      {dialog.kind === 'release' && <p className="text-sm text-[#a6a6a6]">Die Zuweisung wird beendet. Ohne Sperre ist der Deckname sofort wieder verfügbar.</p>}
      {dialog.kind === 'delete' && <p className="text-sm text-[#a6a6a6]">„{entry?.name}“ endgültig aus dem Katalog entfernen?</p>}
      {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" variant={dialog.kind === 'delete' ? 'danger' : 'primary'} loading={loading} disabled={dialog.kind === 'assign' && (!agentIds.length || !!agents.error)}>{dialog.kind === 'delete' ? 'Endgültig löschen' : dialog.kind === 'assign' ? 'Zuweisen' : dialog.kind === 'release' ? 'Freigeben' : 'Speichern'}</Button></div>
    </form>}
  </Modal>
}

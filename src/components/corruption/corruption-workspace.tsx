'use client'

import { displayBadgeNumber } from '@/lib/badge-number'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Check as CheckIcon, ChevronRight, Plus, ShieldAlert, ShieldCheck, SlidersHorizontal, UserPlus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { SearchInput } from '@/components/ui/filter-bar'
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { usePersistentBoolean } from '@/hooks/use-persistent-boolean'
import { useAuth } from '@/context/auth-context'
import { formatDateTime, cn } from '@/lib/utils'
import { officialNumber } from '@/lib/corruption-validation'
import { ReportDetail, MergeOfficial, EditOfficial, OfficialHistory } from './report-tools'
import { useUrlState } from '@/hooks/use-url-state'
import { matchesAgent } from '@/lib/search-match'

export type Agent = { id: string; firstName: string; lastName: string; badgeNumber: string; status: string }
export type OfficialSnapshot = { firstName: string; lastName: string; agency: string; badgeNumber: string | null }
export type OfficialRevision = { id: string; version: number; reason: string; actorName: string; createdAt: string; before: OfficialSnapshot; after: OfficialSnapshot }
export type Official = {
  mergedFrom?: { id: number; firstName: string; lastName: string }[];
  id: number; version?: number; firstName: string; lastName: string; agency: string; badgeNumber: string | null;
  _count?: { checks: number }; checks?: { conductedAt: string; result: string }[];
  revisions?: OfficialRevision[];
}
export type Check = {
  id: string; official: Official; conductedAt: string; result: 'CLEAR' | 'FINDINGS'; findings: string;
  location: string | null; notes: string | null; createdAt: string;
  agents: { id: string; agentId?: string | null; name: string; badgeNumber: string }[];
  createdBy: { displayName: string } | null;
}
type List<T> = { items: T[]; total: number }
const officialHref = (id: number) => `/corruption-checks?official=${id}`
const officialLabel = (person: Official) => `${officialNumber(person.id)} · ${person.firstName} ${person.lastName} · ${person.agency}${person.badgeNumber ? ` · ${person.badgeNumber}` : ''}`
const agentLabel = (agent: Agent) => `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})${agent.status === 'TERMINATED' ? ' · ausgeschieden' : ''}`
function localDateTime(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
function dateBoundary(value: string, nextDay = false) {
  const date = new Date(`${value}T00:00:00`)
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function Pagination({ page, total, loading, onChange }: { page: number; total: number; loading: boolean; onChange: (page: number) => void }) {
  if (total <= 25) return total > 0 ? <p className="mt-3 text-xs text-[#8c8c8c]">{total} Einträge</p> : null
  return <div className="mt-4 flex items-center justify-between gap-2 text-xs text-[#909090]">
    <span>{total} Einträge · Seite {page} von {Math.max(1, Math.ceil(total / 25))}</span>
    <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Zurück</Button><Button type="button" variant="outline" size="sm" disabled={loading || page * 25 >= total} onClick={() => onChange(page + 1)}>Weiter</Button></div>
  </div>
}

function ResultBadge({ result }: { result: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', result === 'FINDINGS' ? 'border-amber-400/25 bg-amber-400/10 text-amber-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200')}>
    {result === 'FINDINGS' ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}{result === 'FINDINGS' ? 'Mit Befund' : 'Ohne Befund'}
  </span>
}

export function CorruptionWorkspace() {
  const params = useSearchParams()
  const officialId = params.get('official')
  return <Workspace key={officialId ?? params.get('tab') ?? 'archive'} officialId={officialId} initialTab={params.get('tab') === 'officials' ? 'officials' : 'archive'} />
}

function Workspace({ officialId, initialTab }: { officialId: string | null; initialTab: 'officials' | 'archive' }) {
  const { user } = useAuth()
  const [search, setSearch] = useUrlState('q', '')
  const [agency, setAgency] = useState('')
  const [result, setResult] = useState('')
  const [agentId, setAgentId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [order, setOrder] = useState('newest')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Check | null>(null)
  const [saved, setSaved] = useState<Check | null>(null)
  const [filtersOpen, setFiltersOpen] = usePersistentBoolean(`fib:corruption:filters:${user?.id ?? 'guest'}`, false)
  const tab = officialId ? 'archive' : initialTab
  const agents = useFetch<Agent[]>('/api/corruption-checks/agents')
  const official = useFetch<Official>(officialId ? `/api/corruption-checks/officials/${encodeURIComponent(officialId)}` : null)
  const query = new URLSearchParams({ search, agency, page: String(page), order })
  if (officialId) query.set('officialId', officialId)
  if (result) query.set('result', result)
  if (agentId) query.set('agentId', agentId)
  if (from) query.set('from', dateBoundary(from))
  if (to) query.set('to', dateBoundary(to, true))
  const controls = useFetch<List<Check>>(tab === 'archive' ? `/api/corruption-checks?${query}` : null)
  const officials = useFetch<List<Official>>(tab === 'officials' ? `/api/corruption-checks/officials?${query}` : null)
  const changed = (set: (value: string) => void, value: string) => { set(value); setPage(1) }
  const failure = controls.error || officials.error || official.error
  const extraFilters = [agency, tab === 'archive' ? agentId : '', tab === 'archive' ? from : '', tab === 'archive' ? to : '', tab === 'archive' && order !== 'newest' ? order : ''].filter(Boolean).length
  const resetFilters = () => { setSearch(''); setAgency(''); setResult(''); setAgentId(''); setFrom(''); setTo(''); setOrder('newest'); setPage(1) }

  return <div className="mx-auto max-w-6xl pb-6">
    <PageHeader
      title="Korruptionskontrollen"
      description="Kontrollen von Staatsbeamten dokumentieren und frühere Befunde nachschlagen. Jeder Beamte bekommt eine feste BEA-Nummer."
      action={<Button disabled={!!officialId && !official.data} onClick={() => setCreating(true)}><Plus size={16} />Kontrolle eintragen</Button>}
    />

    {saved && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
      <span>Kontrolle gespeichert für <Link className="font-semibold underline" href={officialHref(saved.official.id)}>{officialNumber(saved.official.id)} · {saved.official.firstName} {saved.official.lastName}</Link></span>
      <button type="button" aria-label="Hinweis schließen" onClick={() => setSaved(null)} className="text-emerald-200/70 hover:text-emerald-100"><X size={15} /></button>
    </div>}

    {officialId ? <OfficialHeader official={official} onChanged={() => { void official.refetch(); void controls.refetch() }} /> : (
      <nav aria-label="Korruptionskontrollen" className="mb-4 flex gap-1 border-b border-[#343434]">
        {[{ tab: 'archive', label: 'Kontrollen' }, { tab: 'officials', label: 'Beamte' }].map(item => <Link
          key={item.tab}
          href={`/corruption-checks?tab=${item.tab}`}
          aria-current={tab === item.tab ? 'page' : undefined}
          className={cn('-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium', tab === item.tab ? 'border-[#d4d4d4] text-white' : 'border-transparent text-[#909090] hover:text-white')}
        >{item.label}</Link>)}
      </nav>
    )}

    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={value => changed(setSearch, value)} placeholder={tab === 'archive' ? 'BEA-Nummer, Name oder Befund suchen …' : 'BEA-Nummer oder Name suchen …'} className="flex-1" />
        {tab === 'archive' && <div className="flex gap-1 rounded-[10px] border border-[#343434] bg-[#151515] p-1" role="group" aria-label="Ergebnis">
          {[{ value: '', label: 'Alle' }, { value: 'FINDINGS', label: 'Mit Befund' }, { value: 'CLEAR', label: 'Ohne Befund' }].map(option => <button
            key={option.value}
            type="button"
            aria-pressed={result === option.value}
            onClick={() => changed(setResult, option.value)}
            className={cn('rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium', result === option.value ? 'bg-[#2c2c2c] text-white' : 'text-[#909090] hover:text-white')}
          >{option.label}</button>)}
        </div>}
        <Button type="button" variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={14} />Weitere Filter{extraFilters > 0 && <span className="rounded-full bg-[#d4d4d4] px-1.5 text-[11px] font-semibold text-[#181818]">{extraFilters}</span>}
        </Button>
      </div>
      {filtersOpen && <section aria-label="Weitere Filter" className="grid gap-3 rounded-[12px] border border-[#343434] bg-[#141414] p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Behörde" placeholder="z. B. LSPD" maxLength={150} value={agency} onChange={e => changed(setAgency, e.target.value)} />
        {tab === 'archive' && <>
          <Input label="Von" type="date" value={from} onChange={e => changed(setFrom, e.target.value)} />
          <Input label="Bis einschließlich" type="date" value={to} onChange={e => changed(setTo, e.target.value)} />
          <Select label="Durchgeführt von" value={agentId} onValueChange={value => changed(setAgentId, value)} options={[{ value: '', label: 'Alle Agents' }, ...(agents.data ?? []).map(agent => ({ value: agent.id, label: agentLabel(agent) }))]} />
          <Select label="Sortierung" value={order} onValueChange={value => changed(setOrder, value)} options={[{ value: 'newest', label: 'Neueste zuerst' }, { value: 'oldest', label: 'Älteste zuerst' }]} />
        </>}
        <div className="sm:col-span-2 lg:col-span-5"><Button variant="ghost" size="sm" onClick={resetFilters}>Alle Filter zurücksetzen</Button></div>
      </section>}
      {agents.error && <p role="alert" className="text-xs text-red-300">Agent-Auswahl: {agents.error}</p>}
    </div>

    {failure && <p role="alert" className="mb-4 text-sm text-red-300">{failure}</p>}

    {tab === 'archive' ? <>
      {controls.loading && !controls.data ? <Loading /> : !controls.data?.items.length ? <Empty text={search || result || extraFilters ? 'Keine Kontrollen passen zu den Filtern.' : 'Noch keine Kontrollen eingetragen.'} /> : (
        <div className="glass-panel-elevated overflow-hidden rounded-[14px]">
          <div className="hidden grid-cols-[130px_minmax(0,1.4fr)_120px_minmax(0,1fr)_20px] gap-4 border-b border-[#343434] bg-[#1c1c1c] px-4 py-2 text-[11.5px] font-medium text-[#909090] md:grid">
            <span>Datum</span><span>Beamter</span><span>Ergebnis</span><span>Durchgeführt von</span><span />
          </div>
          <ul className="divide-y divide-[#2c2c2c]">
            {controls.data.items.map(check => <li key={check.id}>
              <button type="button" onClick={() => setSelected(check)} className="grid w-full gap-1.5 px-4 py-3 text-left hover:bg-[#232323] focus-visible:outline focus-visible:outline-2 md:grid-cols-[130px_minmax(0,1.4fr)_120px_minmax(0,1fr)_20px] md:items-center md:gap-4">
                <span className="text-[12.5px] text-[#a6a6a6]">{formatDateTime(check.conductedAt)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-white">{check.official.firstName} {check.official.lastName}</span>
                  <span className="block truncate text-[12px] text-[#8c8c8c]">{officialNumber(check.official.id)} · {check.official.agency}{check.location ? ` · ${check.location}` : ''}</span>
                  {check.result === 'FINDINGS' && check.findings && <span className="mt-1 line-clamp-1 block text-[12px] text-amber-100/80">{check.findings}</span>}
                </span>
                <span><ResultBadge result={check.result} /></span>
                <span className="truncate text-[12.5px] text-[#a6a6a6]">{check.agents.map(agent => agent.name).join(', ')}</span>
                <ChevronRight size={16} className="hidden text-[#8c8c8c] md:block" aria-hidden />
              </button>
            </li>)}
          </ul>
        </div>
      )}
      <Pagination page={page} total={controls.data?.total ?? 0} loading={controls.loading} onChange={setPage} />
    </> : <>
      {officials.loading && !officials.data ? <Loading /> : !officials.data?.items.length ? <Empty text={search || extraFilters ? 'Kein Beamter passt zu den Filtern.' : 'Noch keine Beamten erfasst. Die erste Kontrolle legt automatisch eine Akte an.'} /> : (
        <ul className="glass-panel-elevated divide-y divide-[#2c2c2c] overflow-hidden rounded-[14px]">
          {officials.data.items.map(person => <li key={person.id}>
            <Link href={officialHref(person.id)} className="flex items-center gap-4 px-4 py-3 hover:bg-[#232323] focus-visible:outline focus-visible:outline-2">
              <span className="w-[92px] shrink-0 font-mono text-[12px] text-[#909090]">{officialNumber(person.id)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-white">{person.firstName} {person.lastName}</span>
                <span className="block truncate text-[12px] text-[#8c8c8c]">{person.agency}{person.badgeNumber ? ` · DN ${person.badgeNumber}` : ''}</span>
              </span>
              <span className="hidden text-right text-[12px] text-[#909090] sm:block">
                {person._count?.checks ?? 0} Kontrollen
                {person.checks?.[0] && <span className="block">zuletzt {formatDateTime(person.checks[0].conductedAt)}</span>}
              </span>
              {person.checks?.[0] && <ResultBadge result={person.checks[0].result} />}
              <ChevronRight size={16} className="shrink-0 text-[#8c8c8c]" aria-hidden />
            </Link>
          </li>)}
        </ul>
      )}
      <Pagination page={page} total={officials.data?.total ?? 0} loading={officials.loading} onChange={setPage} />
    </>}
    {creating && <CheckForm initialOfficial={official.data ?? undefined} agents={agents.data ?? []} agentsError={agents.error} onClose={() => setCreating(false)} onSaved={check => { setCreating(false); setSaved(check); void controls.refetch(); void officials.refetch(); void official.refetch() }} />}
    {selected && <ReportDetail id={selected.id} agents={agents.data ?? []} onClose={() => setSelected(null)} onChanged={() => { void controls.refetch() }} />}
  </div>
}

function OfficialHeader({ official, onChanged }: { official: { data: Official | null; loading: boolean }; onChanged: () => void }) {
  const person = official.data
  return <section className="glass-panel-elevated mb-5 rounded-[14px] p-5">
    <Link href="/corruption-checks?tab=officials" className="mb-3 inline-flex items-center gap-1 text-xs text-[#a6a6a6] hover:text-white"><ArrowLeft size={13} />Alle Beamten</Link>
    {person ? <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-[#a6a6a6]">{officialNumber(person.id)}</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{person.firstName} {person.lastName}</h2>
          <p className="mt-1 text-sm text-[#a6a6a6]">{person.agency}{person.badgeNumber ? ` · Dienstnummer ${person.badgeNumber}` : ''} · {person._count?.checks ?? 0} Kontrollen</p>
          {!!person.mergedFrom?.length && <p className="mt-1 text-xs text-[#909090]">Zusammengeführte Nummern: {person.mergedFrom.map(p => officialNumber(p.id)).join(', ')}</p>}
        </div>
        <div className="flex flex-wrap gap-2"><EditOfficial official={person} onSaved={onChanged} /><MergeOfficial source={person} /></div>
      </div>
      <OfficialHistory revisions={person.revisions ?? []} />
      <h3 className="mt-5 text-[13px] font-semibold text-white">Kontrollen dieses Beamten</h3>
    </> : <p className="text-sm text-[#909090]">{official.loading ? 'Beamtenakte wird geladen …' : 'Beamtenakte nicht verfügbar.'}</p>}
  </section>
}

function Loading() { return <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-[12px] bg-[#1c1c1c]" />)}</div> }
function Empty({ text }: { text: string }) { return <div className="rounded-[14px] border border-dashed border-[#343434] p-8 text-center text-sm text-[#909090]"><ShieldCheck className="mx-auto mb-3" size={25} />{text}</div> }

function ChoiceCard({ active, onClick, title, text, icon: Icon, tone }: { active: boolean; onClick: () => void; title: string; text: string; icon: typeof ShieldCheck; tone: 'good' | 'warn' }) {
  return <button type="button" role="radio" aria-checked={active} onClick={onClick} className={cn(
    'flex gap-3 rounded-[12px] border p-4 text-left transition-colors',
    active ? (tone === 'good' ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-amber-400/50 bg-amber-400/10') : 'border-[#343434] hover:bg-[#1f1f1f]',
  )}>
    <Icon size={20} className={cn('mt-0.5 shrink-0', tone === 'good' ? 'text-emerald-300' : 'text-amber-300')} />
    <span><span className="block text-[14px] font-medium text-white">{title}</span><span className="mt-0.5 block text-[12.5px] text-[#a6a6a6]">{text}</span></span>
  </button>
}

function CheckForm({ initialOfficial, agents, agentsError, onClose, onSaved }: { initialOfficial?: Official; agents: Agent[]; agentsError: string | null; onClose: () => void; onSaved: (check: Check) => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [person, setPerson] = useState<Official | null>(initialOfficial ?? null)
  const [search, setSearch] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [agency, setAgency] = useState('')
  const [badgeNumber, setBadgeNumber] = useState('')
  const [conductedAt, setConductedAt] = useState(localDateTime())
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [agentSearch, setAgentSearch] = useState('')
  const [result, setResult] = useState<'CLEAR' | 'FINDINGS'>('CLEAR')
  const [findings, setFindings] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const { execute, loading } = useApi<Check>()
  const lookupSearch = mode === 'new' ? `${firstName} ${lastName}`.trim() : search
  const matches = useFetch<List<Official>>(!person || mode === 'new' ? `/api/corruption-checks/officials?search=${encodeURIComponent(lookupSearch)}&page=1` : null)
  const chosenAgents = agentIds.map(id => agents.find(agent => agent.id === id)).filter((agent): agent is Agent => !!agent)
  const agentMatches = agents.filter(agent => !agentIds.includes(agent.id) && agent.status !== 'TERMINATED' && matchesAgent(agentSearch, agent)).slice(0, 40)
  const officialSummary = mode === 'existing' ? (person ? `${person.firstName} ${person.lastName} · ${person.agency}` : '—') : `${firstName} ${lastName} · ${agency} (neu)`

  const submit = async () => {
    if (loading) return
    setFailure('')
    try {
      const check = await execute('/api/corruption-checks', { method: 'POST', body: JSON.stringify({
        requestId, ...(mode === 'existing' ? { officialId: person!.id } : { official: { firstName, lastName, agency, badgeNumber } }),
        conductedAt: new Date(conductedAt).toISOString(), agentIds, result, findings, location, notes,
      }) })
      if (check) onSaved(check)
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen') }
  }

  const steps: WizardStep[] = [
    {
      id: 'beamter',
      label: 'Beamter',
      invalid: mode === 'existing'
        ? (person ? undefined : 'Bitte den kontrollierten Beamten auswählen oder neu anlegen.')
        : (!firstName.trim() || !lastName.trim() || !agency.trim() ? 'Bitte Vorname, Nachname und Behörde angeben.' : undefined),
      content: mode === 'existing' ? <div className="space-y-3">
        <p className="text-sm text-[#a6a6a6]">Wer wurde kontrolliert? Suche nach Name oder BEA-Nummer.</p>
        {person ? <div className="flex items-center justify-between gap-3 rounded-[12px] border border-[#a6a6a6]/50 bg-[#262626] p-4">
          <div><p className="font-mono text-xs text-[#a6a6a6]">{officialNumber(person.id)}</p><p className="mt-0.5 text-[14px] font-medium text-white">{person.firstName} {person.lastName}</p><p className="text-[12.5px] text-[#a6a6a6]">{person.agency}{person.badgeNumber ? ` · DN ${person.badgeNumber}` : ''}</p></div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPerson(null)}>Ändern</Button>
        </div> : <>
          <SearchInput value={search} onChange={setSearch} placeholder="z. B. BEA-000012 oder Alex Miller" />
          <div className="max-h-64 overflow-y-auto rounded-[12px] border border-[#343434]">
            {matches.loading && !matches.data && <p className="p-3 text-[12.5px] text-[#909090]">Suche läuft …</p>}
            {(matches.data?.items ?? []).map(item => <button type="button" key={item.id} onClick={() => setPerson(item)} className="flex w-full items-center gap-3 border-b border-[#262626] px-3 py-2.5 text-left last:border-0 hover:bg-[#232323]">
              <span className="w-[88px] shrink-0 font-mono text-[11.5px] text-[#909090]">{officialNumber(item.id)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-white">{item.firstName} {item.lastName}</span><span className="block truncate text-[12px] text-[#8c8c8c]">{item.agency} · {item._count?.checks ?? 0} Kontrollen</span></span>
            </button>)}
            {matches.data && !matches.data.items.length && <p className="p-3 text-[12.5px] text-[#909090]">Kein Treffer.</p>}
          </div>
          {matches.error && <p role="alert" className="text-xs text-red-300">{matches.error}</p>}
        </>}
        {!person && <Button type="button" variant="secondary" onClick={() => { setMode('new'); const [first = '', ...rest] = search.trim().split(/\s+/); if (!/^bea/i.test(first)) { setFirstName(first); setLastName(rest.join(' ')) } }}><UserPlus size={14} />Beamter noch nicht erfasst – neu anlegen</Button>}
      </div> : <div className="space-y-3">
        <p className="text-sm text-[#a6a6a6]">Der Beamte bekommt beim Speichern automatisch eine feste BEA-Nummer.</p>
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Vorname" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /><Input label="Nachname" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /><Input label="Behörde" required maxLength={150} placeholder="z. B. LSPD, LSSD, Regierung" value={agency} onChange={e => setAgency(e.target.value)} /><Input label="Dienstnummer (optional)" maxLength={100} value={badgeNumber} onChange={e => setBadgeNumber(e.target.value)} /></div>
        {lookupSearch && !!matches.data?.items.length && <div className="rounded-[12px] border border-amber-400/25 bg-amber-400/5 p-3">
          <p className="mb-2 text-xs text-amber-200">Gibt es diesen Beamten schon? Dann bitte die vorhandene Akte nehmen, damit keine Doppelten entstehen:</p>
          {matches.data.items.slice(0, 5).map(item => <button type="button" className="block py-1 text-left text-xs text-[#e5e5e5] hover:underline" key={item.id} onClick={() => { setPerson(item); setMode('existing') }}>{officialLabel(item)} → diese nehmen</button>)}
        </div>}
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode('existing')}><ArrowLeft size={13} />Zurück zur Suche</Button>
      </div>,
    },
    {
      id: 'kontrolle',
      label: 'Ablauf',
      invalid: !conductedAt ? 'Bitte Datum und Uhrzeit angeben.' : !agentIds.length ? 'Bitte mindestens einen durchführenden Agent auswählen.' : undefined,
      content: <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Datum und Uhrzeit" type="datetime-local" required value={conductedAt} onChange={e => setConductedAt(e.target.value)} /><Input label="Ort (optional)" maxLength={200} placeholder="z. B. Vinewood Blvd" value={location} onChange={e => setLocation(e.target.value)} /></div>
        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-[#aeaeae]">Durchführende Agents · {agentIds.length} ausgewählt</p>
          {!!chosenAgents.length && <div className="flex flex-wrap gap-1.5">{chosenAgents.map(agent => <button type="button" key={agent.id} onClick={() => setAgentIds(agentIds.filter(value => value !== agent.id))} className="inline-flex items-center gap-1.5 rounded-full border border-[#4a4a4a] bg-[#262626] px-2.5 py-1 text-[12px] text-white hover:border-[#ff6b6b]/60" aria-label={`${agent.firstName} ${agent.lastName} entfernen`}>{agent.firstName} {agent.lastName}<X size={12} /></button>)}</div>}
          <SearchInput value={agentSearch} onChange={setAgentSearch} placeholder="Agent nach Name oder Dienstnummer suchen …" />
          <div className="max-h-44 overflow-y-auto rounded-[12px] border border-[#343434] p-1">
            {agentMatches.map(agent => <button type="button" key={agent.id} disabled={agentIds.length >= 30} className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-[#e5e5e5] hover:bg-[#232323] disabled:opacity-40" onClick={() => setAgentIds([...agentIds, agent.id])}><Plus size={13} className="text-[#909090]" />{agentLabel(agent)}</button>)}
            {!agentMatches.length && <p className="p-2 text-xs text-[#909090]">{agents.length ? 'Kein weiterer Agent gefunden.' : 'Keine Agents verfügbar.'}</p>}
          </div>
          {agentsError && <p role="alert" className="text-xs text-red-300">{agentsError}</p>}
        </div>
      </div>,
    },
    {
      id: 'ergebnis',
      label: 'Ergebnis',
      invalid: result === 'FINDINGS' && !findings.trim() ? 'Bitte beschreiben, was gefunden wurde.' : undefined,
      content: <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Ergebnis">
          <ChoiceCard active={result === 'CLEAR'} onClick={() => setResult('CLEAR')} title="Ohne Befund" text="Nichts Auffälliges festgestellt." icon={ShieldCheck} tone="good" />
          <ChoiceCard active={result === 'FINDINGS'} onClick={() => setResult('FINDINGS')} title="Mit Befund" text="Es wurde etwas gefunden oder festgestellt." icon={ShieldAlert} tone="warn" />
        </div>
        <Textarea label={result === 'FINDINGS' ? 'Was wurde gefunden?' : 'Anmerkung zum Ergebnis (optional)'} required={result === 'FINDINGS'} maxLength={30000} rows={4} value={findings} onChange={e => setFindings(e.target.value)} placeholder={result === 'FINDINGS' ? 'Gegenstände, Mengen und Feststellungen beschreiben …' : 'Leer lassen, dann wird „Ohne Befund“ gespeichert.'} />
        <Textarea label="Weitere Informationen (optional)" maxLength={30000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        <div className="rounded-[12px] border border-[#343434] bg-[#151515] p-4 text-[12.5px] leading-6 text-[#c4c4c4]">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-white"><CheckIcon size={14} />Zusammenfassung</p>
          <p>Beamter: {officialSummary}</p>
          <p>Zeitpunkt: {conductedAt ? formatDateTime(new Date(conductedAt).toISOString()) : '—'}{location ? ` · ${location}` : ''}</p>
          <p>Agents: {chosenAgents.map(agent => `${agent.firstName} ${agent.lastName}`).join(', ') || '—'}</p>
          <p>Ergebnis: {result === 'FINDINGS' ? 'Mit Befund' : 'Ohne Befund'}</p>
        </div>
        <p className="text-xs text-[#8c8c8c]">Beweise (Fotos, PDFs, Bodycams) hängst du nach dem Speichern im Bericht an.</p>
      </div>,
    },
  ]

  return <Modal open onClose={loading ? () => {} : onClose} title="Korruptionskontrolle eintragen" description="In drei Schritten: Wer, wie, mit welchem Ergebnis." size="xl">
    <Wizard steps={steps} mode="linear" submitLabel="Kontrolle speichern" saving={loading} failure={failure} onCancel={onClose} onSubmit={() => void submit()} />
  </Modal>
}

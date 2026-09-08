'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Archive, ArrowLeft, Plus, ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { formatDateTime, cn } from '@/lib/utils'
import { officialNumber } from '@/lib/corruption-validation'

type Agent = { id: string; firstName: string; lastName: string; badgeNumber: string; status: string }
type Official = {
  id: number; firstName: string; lastName: string; agency: string; badgeNumber: string | null;
  _count?: { checks: number }; checks?: { conductedAt: string; result: string }[];
}
type Check = {
  id: string; official: Official; conductedAt: string; result: 'CLEAR' | 'FINDINGS'; findings: string;
  location: string | null; notes: string | null; createdAt: string;
  agents: { id: string; name: string; badgeNumber: string }[];
  createdBy: { displayName: string } | null;
}
type List<T> = { items: T[]; total: number }
const officialHref = (id: number) => `/corruption-checks?official=${id}`
const officialLabel = (person: Official) => `${officialNumber(person.id)} · ${person.firstName} ${person.lastName} · ${person.agency}${person.badgeNumber ? ` · ${person.badgeNumber}` : ''}`
const agentLabel = (agent: Agent) => `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})${agent.status === 'TERMINATED' ? ' · ausgeschieden' : ''}`
function localDateTime(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }
function dateBoundary(value: string, nextDay = false) {
  const date = new Date(`${value}T00:00:00`)
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function Pagination({ page, total, loading, onChange }: { page: number; total: number; loading: boolean; onChange: (page: number) => void }) {
  return <div className="mt-4 flex items-center justify-between gap-2 text-xs text-[#909090]">
    <span>{total} Einträge · Seite {page} von {Math.max(1, Math.ceil(total / 25))}</span>
    <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>Zurück</Button><Button type="button" variant="outline" size="sm" disabled={loading || page * 25 >= total} onClick={() => onChange(page + 1)}>Weiter</Button></div>
  </div>
}

function ResultBadge({ result }: { result: string }) {
  return <span className={cn('inline-flex rounded-md border px-2 py-1 text-xs font-medium', result === 'FINDINGS' ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200')}>{result === 'FINDINGS' ? 'Mit Befund' : 'Ohne Befund'}</span>
}

export function CorruptionWorkspace() {
  const params = useSearchParams()
  const officialId = params.get('official')
  return <Workspace key={officialId ?? params.get('tab') ?? 'archive'} officialId={officialId} initialTab={params.get('tab') === 'officials' ? 'officials' : 'archive'} />
}

function Workspace({ officialId, initialTab }: { officialId: string | null; initialTab: 'officials' | 'archive' }) {
  const [search, setSearch] = useState('')
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

  return <div className="mx-auto max-w-6xl pb-6">
    <PageHeader title="Korruptionskontrollen" description="Staatsbeamte erfassen, Kontrollen dokumentieren und frühere Befunde nachschlagen." action={<Button disabled={!!officialId && !official.data} onClick={() => setCreating(true)}><Plus size={16} />Kontrolle eintragen</Button>} />
    <nav aria-label="Korruptionskontrollen" className="mb-5 flex flex-wrap gap-2">
      {[{ tab: 'archive', label: 'Kontrollarchiv', icon: Archive }, { tab: 'officials', label: 'Beamtenakten', icon: Users }].map(item => <Link key={item.tab} href={`/corruption-checks?tab=${item.tab}`} aria-current={!officialId && tab === item.tab ? 'page' : undefined} className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', !officialId && tab === item.tab ? 'border-[#707070] bg-[#272727] text-white' : 'border-[#343434] text-[#a6a6a6] hover:text-white')}><item.icon size={15} />{item.label}</Link>)}
    </nav>
    {saved && <div role="status" className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200">Kontrolle gespeichert. Beamtennummer: <Link className="font-semibold underline" href={officialHref(saved.official.id)}>{officialNumber(saved.official.id)} · {saved.official.firstName} {saved.official.lastName}</Link></div>}
    {officialId && <section className="mb-5 rounded-xl border border-[#343434] bg-[#141414] p-5">
      <Link href="/corruption-checks?tab=officials" className="mb-3 inline-flex items-center gap-1 text-xs text-[#a6a6a6]"><ArrowLeft size={13} />Alle Beamtenakten</Link>
      {official.data ? <><p className="font-mono text-xs text-[#a6a6a6]">{officialNumber(official.data.id)}</p><h2 className="mt-1 text-xl font-semibold text-white">{official.data.firstName} {official.data.lastName}</h2><p className="mt-2 text-sm text-[#a6a6a6]">{official.data.agency}{official.data.badgeNumber ? ` · Dienstnummer ${official.data.badgeNumber}` : ''} · {official.data._count?.checks ?? 0} Kontrollen</p></> : <p className="text-sm text-[#909090]">{official.loading ? 'Beamtenakte wird geladen …' : 'Beamtenakte nicht verfügbar.'}</p>}
    </section>}
    <section aria-label="Filter" className="mb-5 space-y-3 rounded-xl border border-[#343434] bg-[#141414] p-4">
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Suche" placeholder={tab === 'archive' ? 'BEA-Nummer, Vorname, Nachname, Befund …' : 'BEA-Nummer, Vorname, Nachname …'} maxLength={200} value={search} onChange={e => changed(setSearch, e.target.value)} /><Input label="Behörde" placeholder="Alle Behörden" maxLength={150} value={agency} onChange={e => changed(setAgency, e.target.value)} /></div>
      {tab === 'archive' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Von" type="date" value={from} onChange={e => changed(setFrom, e.target.value)} />
        <Input label="Bis einschließlich" type="date" value={to} onChange={e => changed(setTo, e.target.value)} />
        <Select label="Befund" value={result} onValueChange={value => changed(setResult, value)} options={[{ value: '', label: 'Alle Befunde' }, { value: 'CLEAR', label: 'Ohne Befund' }, { value: 'FINDINGS', label: 'Mit Befund' }]} />
        <Select label="Durchgeführt von" value={agentId} onValueChange={value => changed(setAgentId, value)} options={[{ value: '', label: 'Alle Agents' }, ...(agents.data ?? []).map(agent => ({ value: agent.id, label: agentLabel(agent) }))]} />
        <Select label="Sortierung" value={order} onValueChange={value => changed(setOrder, value)} options={[{ value: 'newest', label: 'Neueste zuerst' }, { value: 'oldest', label: 'Älteste zuerst' }]} />
      </div>}
      {agents.error && <p role="alert" className="text-xs text-red-300">Agent-Auswahl: {agents.error}</p>}
      <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setAgency(''); setResult(''); setAgentId(''); setFrom(''); setTo(''); setOrder('newest'); setPage(1) }}>Filter zurücksetzen</Button>
    </section>
    {failure && <p role="alert" className="mb-4 text-sm text-red-300">{failure}</p>}
    {tab === 'archive' ? <>
      <h2 className="mb-3 text-base font-semibold text-white">{officialId ? 'Kontrollen dieses Beamten' : 'Alle Korruptionskontrollen'}</h2>
      {controls.loading ? <p className="py-8 text-sm text-[#909090]">Kontrollen werden geladen …</p> : !controls.data?.items.length ? <Empty text="Keine Kontrollen gefunden." /> : <div className="space-y-3">{controls.data.items.map(check => <article key={check.id} className="rounded-xl border border-[#343434] bg-[#141414] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={officialHref(check.official.id)} className="font-semibold text-white hover:underline">{check.official.firstName} {check.official.lastName}</Link><p className="mt-1 text-xs text-[#909090]">{officialNumber(check.official.id)} · {check.official.agency} · {formatDateTime(check.conductedAt)}</p></div><ResultBadge result={check.result} /></div>
        <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-[#c4c4c4]">{check.findings}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[#909090]">Durchgeführt von {check.agents.map(agent => `${agent.name} (${agent.badgeNumber})`).join(', ')}</p><Button size="sm" variant="outline" onClick={() => setSelected(check)}>Bericht öffnen</Button></div>
      </article>)}</div>}
      <Pagination page={page} total={controls.data?.total ?? 0} loading={controls.loading} onChange={setPage} />
    </> : <>
      <h2 className="mb-3 text-base font-semibold text-white">Beamtenakten</h2>
      {officials.loading ? <p className="py-8 text-sm text-[#909090]">Beamtenakten werden geladen …</p> : !officials.data?.items.length ? <Empty text="Keine Beamtenakten gefunden. Die erste Kontrolle legt automatisch eine Akte an." /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{officials.data.items.map(person => <Link href={officialHref(person.id)} key={person.id} className="rounded-xl border border-[#343434] bg-[#141414] p-4 hover:border-[#707070]">
        <p className="font-mono text-xs text-[#909090]">{officialNumber(person.id)}</p><h3 className="mt-2 font-semibold text-white">{person.firstName} {person.lastName}</h3><p className="mt-1 text-sm text-[#a6a6a6]">{person.agency}{person.badgeNumber ? ` · ${person.badgeNumber}` : ''}</p><p className="mt-4 text-xs text-[#909090]">{person._count?.checks ?? 0} Kontrollen{person.checks?.[0] ? ` · Zuletzt ${formatDateTime(person.checks[0].conductedAt)}` : ''}</p>
      </Link>)}</div>}
      <Pagination page={page} total={officials.data?.total ?? 0} loading={officials.loading} onChange={setPage} />
    </>}
    {creating && <CheckForm initialOfficial={official.data ?? undefined} agents={agents.data ?? []} agentsError={agents.error} onClose={() => setCreating(false)} onSaved={check => { setCreating(false); setSaved(check); void controls.refetch(); void officials.refetch(); void official.refetch() }} />}
    {selected && <Modal open onClose={() => setSelected(null)} title="Kontrollbericht" size="xl"><div className="space-y-5">
      <div><Link href={officialHref(selected.official.id)} className="font-semibold text-white underline">{officialLabel(selected.official)}</Link><p className="mt-2 text-sm text-[#a6a6a6]">{formatDateTime(selected.conductedAt)}{selected.location ? ` · ${selected.location}` : ''}</p></div>
      <ResultBadge result={selected.result} />
      <div><h3 className="mb-2 text-sm font-semibold text-white">Befund / Gefundene Gegenstände</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#c4c4c4]">{selected.findings}</p></div>
      <div><h3 className="mb-2 text-sm font-semibold text-white">Durchführende Agents</h3><ul className="space-y-1 text-sm text-[#c4c4c4]">{selected.agents.map(agent => <li key={agent.id}>{agent.name} · {agent.badgeNumber}</li>)}</ul></div>
      {selected.notes && <div><h3 className="mb-2 text-sm font-semibold text-white">Weitere Informationen</h3><p className="whitespace-pre-wrap break-words text-sm text-[#c4c4c4]">{selected.notes}</p></div>}
      <p className="border-t border-[#343434] pt-3 text-xs text-[#909090]">Erfasst von {selected.createdBy?.displayName ?? 'Gelöschtem Benutzer'} am {formatDateTime(selected.createdAt)}</p>
    </div></Modal>}
  </div>
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-[#343434] p-8 text-center text-sm text-[#909090]"><ShieldCheck className="mx-auto mb-3" size={25} />{text}</div> }

function CheckForm({ initialOfficial, agents, agentsError, onClose, onSaved }: { initialOfficial?: Official; agents: Agent[]; agentsError: string | null; onClose: () => void; onSaved: (check: Check) => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [person, setPerson] = useState<Official | null>(initialOfficial ?? null)
  const [search, setSearch] = useState('')
  const [officialPage, setOfficialPage] = useState(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [agency, setAgency] = useState('')
  const [badgeNumber, setBadgeNumber] = useState('')
  const [conductedAt, setConductedAt] = useState(localDateTime())
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [agentSearch, setAgentSearch] = useState('')
  const [result, setResult] = useState('CLEAR')
  const [findings, setFindings] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const { execute, loading } = useApi<Check>()
  const lookupSearch = mode === 'new' ? `${firstName} ${lastName}`.trim() : search
  const matches = useFetch<List<Official>>(`/api/corruption-checks/officials?search=${encodeURIComponent(lookupSearch)}&page=${mode === 'new' ? 1 : officialPage}`)
  const options = new Map((matches.data?.items ?? []).map(item => [String(item.id), { value: String(item.id), label: officialLabel(item) }]))
  if (person) options.set(String(person.id), { value: String(person.id), label: officialLabel(person) })

  return <Modal open onClose={loading ? () => {} : onClose} title="Korruptionskontrolle eintragen" size="xl"><form className="space-y-5" onSubmit={async event => {
    event.preventDefault(); if (loading) return; setFailure('')
    if (mode === 'existing' && !person) { setFailure('Bitte eine Beamtenakte auswählen.'); return }
    if (!agentIds.length) { setFailure('Bitte mindestens einen durchführenden Agent auswählen.'); return }
    try {
      const check = await execute('/api/corruption-checks', { method: 'POST', body: JSON.stringify({
        requestId, ...(mode === 'existing' ? { officialId: person!.id } : { official: { firstName, lastName, agency, badgeNumber } }),
        conductedAt: new Date(conductedAt).toISOString(), agentIds, result, findings, location, notes,
      }) })
      if (check) onSaved(check)
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen') }
  }}>
    <fieldset disabled={loading} className="space-y-4">
      <legend className="mb-3 text-sm font-semibold text-white">Kontrollierter Staatsbeamter</legend>
      <div className="flex flex-wrap gap-2"><Button type="button" variant={mode === 'existing' ? 'secondary' : 'ghost'} onClick={() => setMode('existing')}>Bestehende Beamtenakte</Button><Button type="button" variant={mode === 'new' ? 'secondary' : 'ghost'} onClick={() => setMode('new')}>Neuer Staatsbeamter</Button></div>
      {mode === 'existing' ? <>
        <Input label="Nummer oder Namen suchen" value={search} maxLength={200} onChange={e => { setSearch(e.target.value); setOfficialPage(1) }} placeholder="z. B. BEA-000012 oder Alex Miller" />
        <Select label="Beamtenakte" value={person ? String(person.id) : ''} onValueChange={value => setPerson(matches.data?.items.find(item => String(item.id) === value) ?? (String(person?.id) === value ? person : null))} options={[{ value: '', label: matches.loading ? 'Suche läuft …' : 'Beamtenakte auswählen' }, ...options.values()]} />
        {!matches.loading && !matches.data?.items.length && <p className="text-xs text-[#909090]">Keine Treffer. Bei der ersten Kontrolle „Neuer Staatsbeamter“ wählen.</p>}
        <Pagination page={officialPage} total={matches.data?.total ?? 0} loading={matches.loading} onChange={setOfficialPage} />
      </> : <>
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Vorname" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /><Input label="Nachname" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /><Input label="Behörde" required maxLength={150} placeholder="z. B. LSPD, LSSD, Regierung" value={agency} onChange={e => setAgency(e.target.value)} /><Input label="Dienstnummer (optional)" maxLength={100} value={badgeNumber} onChange={e => setBadgeNumber(e.target.value)} /></div>
        <p className="text-xs text-[#909090]">Die feste BEA-Nummer wird beim Speichern der ersten Kontrolle vergeben.</p>
        {lookupSearch && !!matches.data?.items.length && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3"><p className="mb-2 text-xs text-amber-200">Bereits vorhandene Akten prüfen:</p>{matches.data.items.slice(0, 5).map(item => <button type="button" className="block py-1 text-left text-xs text-[#c4c4c4] hover:underline" key={item.id} onClick={() => { setPerson(item); setMode('existing'); setSearch(officialNumber(item.id)) }}>{officialLabel(item)} → auswählen</button>)}</div>}
      </>}
      {matches.error && <p role="alert" className="text-xs text-red-300">{matches.error}</p>}
    </fieldset>
    <fieldset disabled={loading} className="space-y-4 border-t border-[#343434] pt-4">
      <legend className="text-sm font-semibold text-white">Kontrolle</legend>
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Datum und Uhrzeit (lokale Zeit)" type="datetime-local" required value={conductedAt} onChange={e => setConductedAt(e.target.value)} /><Input label="Ort (optional)" maxLength={200} value={location} onChange={e => setLocation(e.target.value)} /></div>
      <div className="space-y-2"><p className="text-sm text-[#a6a6a6]">Durchführende Agents · {agentIds.length} ausgewählt</p>
        <div className="flex flex-wrap gap-2">{agentIds.map(id => <Button type="button" size="sm" variant="secondary" key={id} onClick={() => setAgentIds(agentIds.filter(value => value !== id))}>{agents.find(agent => agent.id === id)?.firstName} {agents.find(agent => agent.id === id)?.lastName} ×</Button>)}</div>
        <Input aria-label="Agents suchen" placeholder="Agent nach Name oder Dienstnummer suchen …" value={agentSearch} onChange={e => setAgentSearch(e.target.value)} />
        <div className="max-h-36 overflow-y-auto rounded-lg border border-[#343434] p-2">{agents.filter(agent => !agentIds.includes(agent.id) && agentLabel(agent).toLowerCase().includes(agentSearch.toLowerCase())).map(agent => <button type="button" key={agent.id} disabled={agentIds.length >= 30} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#c4c4c4] hover:bg-[#272727] disabled:opacity-40" onClick={() => setAgentIds([...agentIds, agent.id])}>+ {agentLabel(agent)}</button>)}{!agents.length && <p className="p-2 text-xs text-[#909090]">Keine Agents verfügbar.</p>}</div>
        {agentsError && <p role="alert" className="text-xs text-red-300">{agentsError}</p>}
      </div>
      <Select label="Ergebnis" value={result} onValueChange={setResult} options={[{ value: 'CLEAR', label: 'Ohne Befund' }, { value: 'FINDINGS', label: 'Mit Befund' }]} />
      <Textarea label="Befund / Was wurde gefunden?" required={result === 'FINDINGS'} maxLength={30000} rows={4} value={findings} onChange={e => setFindings(e.target.value)} placeholder={result === 'FINDINGS' ? 'Gegenstände, Mengen und Feststellungen beschreiben …' : 'Optional ergänzen; sonst wird „Ohne Befund“ gespeichert.'} />
      <Textarea label="Weitere Informationen (optional)" maxLength={30000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
    </fieldset>
    {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" loading={loading} disabled={!agents.length || !!agentsError}>Kontrolle speichern</Button></div>
  </form></Modal>
}

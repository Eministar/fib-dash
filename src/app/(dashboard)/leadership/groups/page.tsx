'use client'

import { useState } from 'react'
import { Users, Plus, ShieldCheck, ExternalLink, Pencil, X } from 'lucide-react'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { leadershipGroupSchema, type LeadershipGroupInput } from '@/lib/leadership-groups'

type Member = { id: string; displayName: string }
type Family = { id: string; title: string }
type Group = {
  id: string; name: string; version: number; syncPending: boolean; discordUrl: string | null
  members: Member[]; families: (LeadershipGroupInput['families'][number] & { title: string })[]
}
type Data = { manage: boolean; groups: Group[]; members: Member[]; families: Family[] }
const field = 'w-full rounded-lg border border-white/15 bg-[#171717] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40'

export default function LeadershipGroupsPage() {
  const { data, error, loading, refetch } = useFetch<Data>('/api/leadership/groups')
  const [editing, setEditing] = useState<{ id?: string; input: LeadershipGroupInput } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  const update = (patch: Partial<LeadershipGroupInput>) => setEditing(old => old ? { ...old, input: { ...old.input, ...patch } } : null)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    const parsed = leadershipGroupSchema.safeParse(editing.input)
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/leadership/groups${editing.id ? `/${editing.id}` : ''}`, {
        method: editing.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Speichern fehlgeschlagen.')
      setEditing(null)
      setMessage(result.data.synced ? 'Gruppe gespeichert und Discord aktualisiert.' : 'Gruppe gespeichert. Discord-Abgleich ausstehend: Entfernte Mitglieder können dort bis zum erfolgreichen Abgleich noch Zugriff haben. Der Abgleich wird automatisch wiederholt.')
      await refetch()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Leadership</p>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-white"><Users size={25} /> Ermittlungsgruppen</h1>
        <p className="mt-2 text-sm text-neutral-400">{data?.manage ? 'Gruppen organisieren, Familien zuweisen und Leitungen bestimmen.' : 'Deine Gruppen, Familien und zuständigen Leitungen.'}</p>
      </div>
      {data?.manage && !editing && <Button onClick={() => { setEditing({ input: { name: '', memberIds: [], families: [] } }); setMessage(''); setSearch('') }}><Plus size={16} /> Gruppe erstellen</Button>}
    </header>
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm text-neutral-400"><ShieldCheck className="shrink-0" size={19} /><p>Vertraulich: Mitglieder sehen nur ihre eigenen Gruppen. Änderungen erscheinen ausschließlich im jeweiligen Discord-Kanal. Leadership kann alle Gruppen verwalten.</p></div>
    {message && <p role="status" className="rounded-lg border border-white/20 p-4 text-sm text-neutral-200">{message}</p>}
    {error && <div role="alert" className="text-red-400">{error} <button className="underline" onClick={() => void refetch()}>Erneut laden</button></div>}
    {loading && !data && <p className="text-neutral-400">Gruppen werden geladen …</p>}

    {editing && data?.manage && <form onSubmit={save} className="space-y-5 rounded-xl border border-white/20 bg-[#111] p-5">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editing.id ? 'Gruppe bearbeiten' : 'Neue Ermittlungsgruppe'}</h2><button type="button" aria-label="Bearbeitung schließen" disabled={busy} onClick={() => setEditing(null)}><X size={20} /></button></div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <label className="block space-y-2 text-sm"><span>Gruppenname</span><input required maxLength={100} className={field} value={editing.input.name} onChange={e => update({ name: e.target.value })} placeholder="z. B. Ermittlungsgruppe Nord" /></label>
        <div className="space-y-2"><h3 className="text-sm font-medium">Mitglieder ({editing.input.memberIds.length})</h3>
          <input aria-label="Mitglieder suchen" className={field} placeholder="Mitglieder suchen …" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-white/10 p-3 sm:grid-cols-2">
            {data.members.filter(m => m.displayName.toLowerCase().includes(search.toLowerCase())).map(m => <label key={m.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={editing.input.memberIds.includes(m.id)} onChange={e => {
              update({ memberIds: e.target.checked ? [...editing.input.memberIds, m.id] : editing.input.memberIds.filter(id => id !== m.id), families: editing.input.families.map(f => ({ ...f, leadIds: e.target.checked ? f.leadIds : f.leadIds.filter(id => id !== m.id) })) })
            }} />{m.displayName}</label>)}
          </div><p className="text-xs text-neutral-500">Auswählbar sind Konten mit Discord-Verknüpfung. Eine Person kann mehrere Familien leiten.</p>
        </div>
        <div className="space-y-3"><h3 className="text-sm font-medium">Familien & Leitungen</h3>
          {editing.input.families.map((family, index) => <div key={family.dossierId} className="grid items-end gap-3 rounded-lg border border-white/10 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <p className="self-center text-sm">{data.families.find(f => f.id === family.dossierId)?.title ?? 'Familienakte nicht verfügbar'}</p>
            {[0, 1].map(slot => <label key={slot} className="space-y-1 text-xs text-neutral-400"><span>{slot === 0 ? 'Leitung 1 (Pflicht)' : 'Leitung 2 (optional)'}</span><select required={slot === 0} className={field} value={family.leadIds[slot] ?? ''} onChange={e => {
              const leads = [...family.leadIds]; leads[slot] = e.target.value
              update({ families: editing.input.families.map((f, i) => i === index ? { ...f, leadIds: leads.filter(Boolean) } : f) })
            }}><option value="">Bitte auswählen</option>{data.members.filter(m => editing.input.memberIds.includes(m.id) && (m.id === family.leadIds[slot] || !family.leadIds.includes(m.id))).map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>)}
            <button type="button" className="p-2 text-neutral-400 hover:text-white" aria-label={`${data.families.find(f => f.id === family.dossierId)?.title ?? 'Familie'} entfernen`} onClick={() => update({ families: editing.input.families.filter((_, i) => i !== index) })}><X size={18} /></button>
          </div>)}
          <select aria-label="Familie hinzufügen" className={field} value="" onChange={e => { if (e.target.value) update({ families: [...editing.input.families, { dossierId: e.target.value, leadIds: [] }] }) }}><option value="">+ Familie aus den Familienakten zuweisen</option>{data.families.filter(f => !editing.input.families.some(assigned => assigned.dossierId === f.id)).map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
          {!data.families.length && <p className="text-sm text-neutral-500">Lege zunächst unter Ermittlungen → Akten eine Familienakte an.</p>}
        </div>
        <div className="flex gap-3"><Button type="submit">{busy ? 'Wird gespeichert …' : 'Gruppe speichern'}</Button><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Abbrechen</Button></div>
      </fieldset>
    </form>}

    {!error && data && <div className="grid gap-4 lg:grid-cols-2">{data.groups.map(group => <article key={group.id} className="space-y-4 rounded-xl border border-white/10 bg-[#111] p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{group.name}</h2><p className="mt-1 text-xs text-neutral-500">{group.members.length} Mitglieder · {group.families.length} Familien</p></div>{data.manage && <button aria-label={`${group.name} bearbeiten`} className="rounded-lg p-2 hover:bg-white/10" onClick={() => { setEditing({ id: group.id, input: { name: group.name, version: group.version, memberIds: group.members.map(m => m.id), families: group.families.map(f => ({ dossierId: f.dossierId, leadIds: f.leadIds })) } }); setMessage(''); setSearch(''); window.scrollTo({ top: 0, behavior: 'instant' }) }}><Pencil size={16} /></button>}</div>
      <div className="flex flex-wrap gap-2">{group.members.map(m => <span key={m.id} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-neutral-300">{m.displayName}</span>)}</div>
      <dl className="divide-y divide-white/5">{group.families.map(f => <div key={f.dossierId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><dt className="text-neutral-200">{f.title}</dt><dd className="text-neutral-400">{f.leadIds.map(id => group.members.find(m => m.id === id)?.displayName ?? 'Nicht verfügbar').join(' & ')}</dd></div>)}</dl>
      {!group.families.length && <p className="text-sm text-neutral-500">Noch keine Familien zugewiesen.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">{group.discordUrl && <a href={group.discordUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-neutral-300 hover:text-white">Discord-Kanal öffnen <ExternalLink size={13} /></a>}<span className={group.syncPending ? 'text-amber-400' : 'text-emerald-400'}>{group.syncPending ? 'Discord-Abgleich ausstehend – Kanalrechte ggf. noch nicht aktuell' : 'Discord synchronisiert'}</span></div>
    </article>)}{!data.groups.length && <p className="col-span-full rounded-xl border border-dashed border-white/15 p-10 text-center text-neutral-500">{data.manage ? 'Noch keine Ermittlungsgruppen. Erstelle die erste Gruppe.' : 'Du bist keiner Ermittlungsgruppe zugeordnet.'}</p>}</div>}
  </div>
}

'use client'

import { useState } from 'react'
import { Users, Plus, ShieldCheck, ExternalLink, Pencil, Trash2, X } from 'lucide-react'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { leadershipGroupSchema, type LeadershipGroupInput } from '@/lib/leadership-groups'

type Member = { id: string; displayName: string }
type Group = {
  id: string; name: string; version: number; syncPending: boolean; discordUrl: string | null; channelId: string
  members: Member[]; families: LeadershipGroupInput['families']
}
type Data = { manage: boolean; groups: Group[]; members: Member[] }
const field = 'w-full rounded-lg border border-white/15 bg-[#171717] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40'
const PENDING = 'Discord-Abgleich ausstehend: Entfernte Mitglieder können dort bis zum erfolgreichen Abgleich noch Zugriff haben. Der Abgleich wird automatisch wiederholt.'

export default function LeadershipGroupsPage() {
  const { data, error, loading, refetch } = useFetch<Data>('/api/leadership/groups')
  const [editing, setEditing] = useState<{ id?: string; input: LeadershipGroupInput } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  const update = (patch: Partial<LeadershipGroupInput>) => setEditing(old => old ? { ...old, input: { ...old.input, ...patch } } : null)
  const editFamilies = (map: (families: LeadershipGroupInput['families']) => LeadershipGroupInput['families']) =>
    setEditing(old => old ? { ...old, input: { ...old.input, families: map(old.input.families) } } : null)

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
      setMessage(result.data.synced ? 'Gruppe gespeichert und Discord aktualisiert.' : `Gruppe gespeichert. ${PENDING}`)
      await refetch()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  async function remove(group: Group) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/leadership/groups/${group.id}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Löschen fehlgeschlagen.')
      setConfirmDelete(null)
      if (editing?.id === group.id) setEditing(null)
      setMessage(!result.data.discordCleaned
        ? `Gruppe gelöscht. Der Dashboard-Zugriff ist sofort beendet, der Discord-Kanal „${group.name}“ konnte aber nicht bereinigt werden – bitte dort manuell prüfen.`
        : result.data.channelKept
          ? 'Gruppe gelöscht. Der bestehende Discord-Kanal bleibt erhalten, alle Mitgliederfreigaben wurden entzogen.'
          : 'Gruppe gelöscht und der zugehörige Discord-Kanal entfernt.')
      await refetch()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Leadership</p>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-white"><Users size={25} /> Ermittlungsgruppen</h1>
        <p className="mt-2 text-sm text-neutral-400">{data?.manage ? 'Gruppen organisieren, Familien zuweisen und Leitungen bestimmen.' : 'Deine Gruppen, Familien und zuständigen Leitungen.'}</p>
      </div>
      {data?.manage && !editing && <Button onClick={() => { setEditing({ input: { name: '', channelId: '', memberIds: [], families: [] } }); setMessage(''); setSearch('') }}><Plus size={16} /> Gruppe erstellen</Button>}
    </header>
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm text-neutral-400"><ShieldCheck className="shrink-0" size={19} /><p>Vertraulich: Mitglieder sehen nur ihre eigenen Gruppen. Änderungen erscheinen ausschließlich im jeweiligen Discord-Kanal. Leadership kann alle Gruppen verwalten.</p></div>
    {message && <p role="status" className="rounded-lg border border-white/20 p-4 text-sm text-neutral-200">{message}</p>}
    {error && <div role="alert" className="text-red-400">{error} <button className="underline" onClick={() => void refetch()}>Erneut laden</button></div>}
    {loading && !data && <p className="text-neutral-400">Gruppen werden geladen …</p>}

    {editing && data?.manage && <form onSubmit={save} className="space-y-5 rounded-xl border border-white/20 bg-[#111] p-5">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editing.id ? 'Gruppe bearbeiten' : 'Neue Ermittlungsgruppe'}</h2><button type="button" aria-label="Bearbeitung schließen" disabled={busy} onClick={() => setEditing(null)}><X size={20} /></button></div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm"><span>Gruppenname</span><input required maxLength={100} className={field} value={editing.input.name} onChange={e => update({ name: e.target.value })} placeholder="z. B. Ermittlungsgruppe Nord" /></label>
          <label className="block space-y-2 text-sm"><span>Discord-Kanal-ID (optional)</span>
            <input inputMode="numeric" pattern="\d{17,22}" maxLength={22} className={field} value={editing.input.channelId ?? ''} onChange={e => update({ channelId: e.target.value.trim() })} placeholder="Leer lassen = eigener Kanal wird angelegt" />
            <span className="block text-xs text-neutral-500">Bestehenden Kanal nutzen: ID eintragen. Dessen Rechte werden durch die Gruppenfreigabe ersetzt (@everyone gesperrt, nur Mitglieder und Bot).</span>
          </label>
        </div>
        <div className="space-y-2"><h3 className="text-sm font-medium">Mitglieder ({editing.input.memberIds.length})</h3>
          <input aria-label="Mitglieder suchen" className={field} placeholder="Mitglieder suchen …" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-white/10 p-3 sm:grid-cols-2">
            {data.members.filter(m => m.displayName.toLowerCase().includes(search.toLowerCase())).map(m => <label key={m.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={editing.input.memberIds.includes(m.id)} onChange={e => {
              update({ memberIds: e.target.checked ? [...editing.input.memberIds, m.id] : editing.input.memberIds.filter(id => id !== m.id), families: editing.input.families.map(f => ({ ...f, leadIds: e.target.checked ? f.leadIds : f.leadIds.filter(id => id !== m.id) })) })
            }} />{m.displayName}</label>)}
          </div><p className="text-xs text-neutral-500">Auswählbar sind Konten mit Discord-Verknüpfung. Eine Person kann mehrere Familien leiten.</p>
        </div>
        <div className="space-y-3"><h3 className="text-sm font-medium">Familien & Leitungen ({editing.input.families.length})</h3>
          {editing.input.families.map((family, index) => <div key={index} className="grid items-end gap-3 rounded-lg border border-white/10 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="space-y-1 text-xs text-neutral-400"><span>Familie</span>
              <input required maxLength={100} className={field} value={family.name} placeholder="z. B. Familie Cabrera" onChange={e => editFamilies(families => families.map((f, i) => i === index ? { ...f, name: e.target.value } : f))} />
            </label>
            {[0, 1].map(slot => <label key={slot} className="space-y-1 text-xs text-neutral-400"><span>{slot === 0 ? 'Leitung 1 (Pflicht)' : 'Leitung 2 (optional)'}</span><select required={slot === 0} className={field} value={family.leadIds[slot] ?? ''} onChange={e => {
              const leads = [...family.leadIds]; leads[slot] = e.target.value
              editFamilies(families => families.map((f, i) => i === index ? { ...f, leadIds: leads.filter(Boolean) } : f))
            }}><option value="">Bitte auswählen</option>{data.members.filter(m => editing.input.memberIds.includes(m.id) && (m.id === family.leadIds[slot] || !family.leadIds.includes(m.id))).map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>)}
            <button type="button" className="p-2 text-neutral-400 hover:text-white" aria-label={`Familie ${index + 1} entfernen`} onClick={() => editFamilies(families => families.filter((_, i) => i !== index))}><X size={18} /></button>
          </div>)}
          <Button type="button" variant="outline" onClick={() => editFamilies(families => [...families, { name: '', leadIds: [] }])}><Plus size={15} /> Familie hinzufügen</Button>
          {!editing.input.memberIds.length && <p className="text-xs text-neutral-500">Wähle zuerst Mitglieder aus, um Leitungen vergeben zu können.</p>}
        </div>
        <div className="flex gap-3"><Button type="submit">{busy ? 'Wird gespeichert …' : 'Gruppe speichern'}</Button><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Abbrechen</Button></div>
      </fieldset>
    </form>}

    {!error && data && <div className="grid gap-4 lg:grid-cols-2">{data.groups.map(group => <article key={group.id} className="space-y-4 rounded-xl border border-white/10 bg-[#111] p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{group.name}</h2><p className="mt-1 text-xs text-neutral-500">{group.members.length} Mitglieder · {group.families.length} Familien</p></div>
        {data.manage && <div className="flex gap-1">
          <button aria-label={`${group.name} bearbeiten`} className="rounded-lg p-2 hover:bg-white/10" onClick={() => { setEditing({ id: group.id, input: { name: group.name, channelId: group.channelId, version: group.version, memberIds: group.members.map(m => m.id), families: group.families.map(f => ({ name: f.name, leadIds: f.leadIds })) } }); setConfirmDelete(null); setMessage(''); setSearch(''); window.scrollTo({ top: 0, behavior: 'instant' }) }}><Pencil size={16} /></button>
          <button aria-label={`${group.name} löschen`} className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-red-300" onClick={() => setConfirmDelete(group.id)}><Trash2 size={16} /></button>
        </div>}
      </div>
      {confirmDelete === group.id && <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
        <p className="text-neutral-200">Gruppe „{group.name}“ endgültig löschen? {group.channelId ? 'Der bestehende Discord-Kanal bleibt erhalten, alle Mitgliederfreigaben werden entzogen.' : 'Der zugehörige Discord-Kanal wird mitsamt Verlauf gelöscht.'}</p>
        <div className="flex gap-2"><Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void remove(group)}>{busy ? 'Wird gelöscht …' : 'Endgültig löschen'}</Button><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmDelete(null)}>Abbrechen</Button></div>
      </div>}
      <div className="flex flex-wrap gap-2">{group.members.map(m => <span key={m.id} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-neutral-300">{m.displayName}</span>)}</div>
      <dl className="divide-y divide-white/5">{group.families.map((f, index) => <div key={index} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><dt className="text-neutral-200">{f.name}</dt><dd className="text-neutral-400">{f.leadIds.map(id => group.members.find(m => m.id === id)?.displayName ?? 'Nicht verfügbar').join(' & ')}</dd></div>)}</dl>
      {!group.families.length && <p className="text-sm text-neutral-500">Noch keine Familien zugewiesen.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">{group.discordUrl && <a href={group.discordUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-neutral-300 hover:text-white">Discord-Kanal öffnen <ExternalLink size={13} /></a>}<span className={group.syncPending ? 'text-amber-400' : 'text-emerald-400'}>{group.syncPending ? 'Discord-Abgleich ausstehend – Kanalrechte ggf. noch nicht aktuell' : 'Discord synchronisiert'}</span></div>
    </article>)}{!data.groups.length && <p className="col-span-full rounded-xl border border-dashed border-white/15 p-10 text-center text-neutral-500">{data.manage ? 'Noch keine Ermittlungsgruppen. Erstelle die erste Gruppe.' : 'Du bist keiner Ermittlungsgruppe zugeordnet.'}</p>}</div>}
  </div>
}

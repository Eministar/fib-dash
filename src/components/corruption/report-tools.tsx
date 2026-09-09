'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { officialNumber } from '@/lib/corruption-validation'
import { uploadInChunks, formatRate, formatRemaining, type UploadProgress } from '@/lib/chunked-upload'
import { formatDateTime } from '@/lib/utils'
import type { Agent, Check, Official } from './corruption-workspace'

type Snapshot = { conductedAt: string; result: string; findings: string; location: string | null; notes: string | null; agents: { name: string; badgeNumber: string }[] }
type Evidence = { id: string; title: string; mimeType: string | null; clipId: string | null; uploadedByName: string; createdAt: string }
type Report = Check & { version: number; evidence: Evidence[]; revisions: { id: string; version: number; reason: string; actorName: string; createdAt: string; before: Snapshot; after: Snapshot }[] }
const personLabel = (p: Official) => `${officialNumber(p.id)} · ${p.firstName} ${p.lastName} · ${p.agency}${p.badgeNumber ? ` · ${p.badgeNumber}` : ''}`
const localTime = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16) }

export function MergeOfficial({ source }: { source: Official }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<Official | null>(null)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState('')
  const router = useRouter()
  const { execute, loading } = useApi<{ target: Official }>()
  const { data, error } = useFetch<{ items: Official[] }>(open ? `/api/corruption-checks/officials?search=${encodeURIComponent(search)}` : null)
  return <div className="mb-3"><Button variant="outline" size="sm" onClick={() => setOpen(true)}>Doppelte Akte zusammenführen</Button>
    <Modal open={open} onClose={loading ? () => {} : () => setOpen(false)} title="Beamtenakten zusammenführen" size="lg"><div className="space-y-4">
      <p className="text-sm text-[#c4c4c4]">Alle Kontrollen von <strong>{personLabel(source)}</strong> in die folgende Zielakte übernehmen. Deren Stammdaten bleiben bestehen; die bisherige Nummer verweist anschließend auf die Zielakte.</p>
      <Input label="Zielakte suchen" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} placeholder="Nummer oder Name" />
      <Select label="Zielakte" value={target ? String(target.id) : ''} onValueChange={id => setTarget(data?.items.find(p => String(p.id) === id) ?? null)} options={[{ value: '', label: 'Zielakte wählen' }, ...[...new Map([...(data?.items ?? []), ...(target ? [target] : [])].filter(p => p.id !== source.id).map(p => [p.id, p])).values()].map(p => ({ value: String(p.id), label: personLabel(p) }))]} />
      <Textarea label="Begründung" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Warum handelt es sich um dieselbe Person?" />
      {(error || failure) && <p role="alert" className="text-sm text-red-300">{error || failure}</p>}
      {target && <p className="rounded-lg border border-amber-400/20 p-3 text-sm text-amber-200">Ziel: {personLabel(target)}. Sämtliche Kontrollen beider Akten bleiben erhalten.</p>}
      <Button loading={loading} disabled={!target || reason.trim().length < 3} onClick={async () => { try { const result = await execute(`/api/corruption-checks/officials/${source.id}/merge`, { method: 'POST', body: JSON.stringify({ targetId: target!.id, reason }) }); setOpen(false); router.push(`/corruption-checks?official=${result!.target.id}`) } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Zusammenführen fehlgeschlagen') } }}>In diese Zielakte zusammenführen</Button>
    </div></Modal>
  </div>
}

function SnapshotView({ data }: { data: Snapshot }) {
  return <div className="space-y-2 text-sm text-[#c4c4c4]"><p>{formatDateTime(data.conductedAt)} · {data.result === 'CLEAR' ? 'Ohne Befund' : 'Mit Befund'}</p><p>{data.location || 'Kein Ort'}</p><p className="whitespace-pre-wrap break-words">{data.findings}</p>{data.notes && <p className="whitespace-pre-wrap break-words">{data.notes}</p>}<p className="text-xs text-[#909090]">{data.agents.map(a => `${a.name} (${a.badgeNumber})`).join(', ')}</p></div>
}

export function ReportDetail({ id, agents, onClose, onChanged }: { id: string; agents: Agent[]; onClose: () => void; onChanged: () => void }) {
  const { data, error, refetch } = useFetch<Report>(`/api/corruption-checks/${id}`)
  const [editing, setEditing] = useState(false)
  return <Modal open onClose={onClose} title="Kontrollbericht" size="xl">
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!data ? <p className="text-sm text-[#909090]">Bericht wird geladen …</p> : <div className="space-y-6">
      <div><h3 className="font-semibold text-white">{personLabel(data.official)}</h3><p className="mt-1 text-xs text-[#909090]">Version {data.version} · Erfasst von {data.createdBy?.displayName ?? 'Gelöschtem Benutzer'} am {formatDateTime(data.createdAt)}</p></div>
      <SnapshotView data={data} />
      <Button variant="outline" onClick={() => setEditing(true)}>Bericht korrigieren</Button>
      <EvidencePanel report={data} onChanged={refetch} />
      <section className="space-y-3 border-t border-[#343434] pt-4"><h3 className="font-semibold text-white">Änderungshistorie</h3>{!data.revisions.length && <p className="text-sm text-[#909090]">Noch keine Korrekturen.</p>}{data.revisions.map(revision => <details key={revision.id} className="rounded-lg border border-[#343434] p-3"><summary className="cursor-pointer text-sm text-[#c4c4c4]">Version {revision.version} · {revision.actorName} · {formatDateTime(revision.createdAt)}</summary><p className="my-3 whitespace-pre-wrap text-sm text-[#c4c4c4]">{revision.reason}</p><div className="grid gap-4 sm:grid-cols-2"><div><h4 className="mb-2 text-xs font-semibold text-white">Vorher</h4><SnapshotView data={revision.before} /></div><div><h4 className="mb-2 text-xs font-semibold text-white">Nachher</h4><SnapshotView data={revision.after} /></div></div></details>)}</section>
      {editing && <CorrectionForm report={data} agents={agents} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refetch(); onChanged() }} />}
    </div>}
  </Modal>
}

function CorrectionForm({ report, agents, onClose, onSaved }: { report: Report; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(localTime(report.conductedAt))
  const [result, setResult] = useState(report.result)
  const [findings, setFindings] = useState(report.findings)
  const [location, setLocation] = useState(report.location ?? '')
  const [notes, setNotes] = useState(report.notes ?? '')
  const [reason, setReason] = useState('')
  const [ids, setIds] = useState(report.agents.flatMap(a => a.agentId ? [a.agentId] : []))
  const [failure, setFailure] = useState('')
  const { execute, loading } = useApi()
  return <Modal open onClose={loading ? () => {} : onClose} title="Bericht korrigieren" size="xl"><form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (loading) return; try { await execute(`/api/corruption-checks/${report.id}`, { method: 'PATCH', body: JSON.stringify({ version: report.version, reason, conductedAt: new Date(when).toISOString(), agentIds: ids, result, findings, location, notes }) }); onSaved() } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Korrektur fehlgeschlagen') } }}>
    <Input label="Datum und Uhrzeit (lokal)" type="datetime-local" required value={when} onChange={e => setWhen(e.target.value)} />
    <Input label="Ort" maxLength={200} value={location} onChange={e => setLocation(e.target.value)} />
    <fieldset className="max-h-40 space-y-2 overflow-auto rounded-lg border border-[#343434] p-3"><legend className="text-sm text-[#a6a6a6]">Durchführende Agents</legend>{agents.map(a => <label key={a.id} className="flex items-center gap-2 text-sm text-[#c4c4c4]"><input type="checkbox" checked={ids.includes(a.id)} onChange={e => setIds(e.target.checked ? [...ids, a.id] : ids.filter(id => id !== a.id))} />{a.firstName} {a.lastName} ({a.badgeNumber})</label>)}</fieldset>
    <Select label="Ergebnis" value={result} onValueChange={value => setResult(value as 'CLEAR' | 'FINDINGS')} options={[{ value: 'CLEAR', label: 'Ohne Befund' }, { value: 'FINDINGS', label: 'Mit Befund' }]} />
    <Textarea label="Befund" required={result === 'FINDINGS'} maxLength={30000} rows={4} value={findings} onChange={e => setFindings(e.target.value)} />
    <Textarea label="Weitere Informationen" maxLength={30000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
    <Textarea label="Begründung der Korrektur" required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
    <p className="text-xs text-[#909090]">Die bisherige Fassung bleibt mit Bearbeiter, Zeitpunkt und Begründung in der Historie erhalten.</p>
    {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
    {report.agents.some(a => !a.agentId) && <p className="text-xs text-[#909090]">Historische Angaben zu inzwischen gelöschten Agents bleiben erhalten.</p>}
    <Button type="submit" loading={loading} disabled={!ids.length && !report.agents.some(a => !a.agentId)}>Korrektur speichern</Button>
  </form></Modal>
}

function EvidencePanel({ report, onChanged }: { report: Report; onChanged: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [message, setMessage] = useState('')
  const [chooseClip, setChooseClip] = useState(false)
  const [search, setSearch] = useState('')
  const [clipId, setClipId] = useState('')
  const [preview, setPreview] = useState<Evidence | null>(null)
  const access = useFetch<{ allowed: boolean }>('/api/investigations/clips/access')
  const clips = useFetch<{ id: string; title: string }[]>(chooseClip && access.data?.allowed ? `/api/investigations/clips?search=${encodeURIComponent(search)}` : null)
  const { execute, loading } = useApi()
  const fileUrl = (e: Evidence) => `/api/corruption-checks/evidence/${e.id}/file`
  return <section className="space-y-3 border-t border-[#343434] pt-4"><h3 className="font-semibold text-white">Beweise</h3>
    {!report.evidence.length && <p className="text-sm text-[#909090]">Noch keine Beweise angehängt.</p>}
    {report.evidence.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#343434] p-3"><div><p className="text-sm text-[#c4c4c4]">{item.title}</p><p className="text-xs text-[#909090]">{item.uploadedByName} · {formatDateTime(item.createdAt)}</p></div>{item.mimeType === 'application/pdf' ? <a href={fileUrl(item)} className="text-xs text-[#c4b5fd] underline">PDF herunterladen</a> : <Button size="sm" variant="outline" onClick={() => setPreview(item)}>Ansehen</Button>}</div>)}
    <Input key={fileKey} label="Foto, PDF oder Bodycam-Datei (max. 500 MB)" type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,video/mp4,video/webm,video/quicktime" onChange={e => { const next = e.target.files?.[0] ?? null; setFile(next); setTitle(next?.name.slice(0,200) ?? '') }} />
    {file && <><Input label="Bezeichnung" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /><Button loading={uploading} disabled={!title.trim()} onClick={async () => {
      if (file.size > 500 * 1024 * 1024) { setMessage('Datei zu groß (max. 500 MB)'); return }
      setUploading(true); setMessage('')
      try {
        const ticket = await uploadInChunks(file, 'EVIDENCE', { onProgress: setProgress })
        const response = await fetch(`/api/corruption-checks/${report.id}/evidence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ uploadId: ticket.uploadId, title }) })
        const json = await response.json()
        if (!response.ok || !json.success) throw new Error(json.error || 'Upload fehlgeschlagen')
        setFile(null); setFileKey(key => key + 1); await onChanged(); setMessage('Beweis gespeichert.')
      } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Upload fehlgeschlagen') } finally { setUploading(false); setProgress(null) }
    }}>Beweis hochladen</Button>{progress && <div><div className="h-1.5 w-full overflow-hidden rounded-full bg-[#232323]"><div className="h-full rounded-full bg-[#a78bfa] transition-[width] duration-200" style={{ width: `${progress.percent}%` }} /></div><p className="mt-1 flex flex-wrap gap-x-2 text-xs text-[#909090]"><span>{progress.percent}% übertragen{progress.percent === 100 ? ' – wird zusammengesetzt…' : ''}</span>{formatRate(progress.bytesPerSecond) && <span>· {formatRate(progress.bytesPerSecond)}</span>}{formatRemaining(progress.secondsRemaining) && <span>· {formatRemaining(progress.secondsRemaining)}</span>}</p>{progress.resumed && <p className="mt-1 text-xs text-[#c4b5fd]">Angefangene Übertragung gefunden – wird fortgesetzt.</p>}</div>}</>}
    {access.data?.allowed && <Button variant="outline" size="sm" onClick={() => setChooseClip(!chooseClip)}>Bodycam aus Katalog verknüpfen</Button>}
    {chooseClip && <div className="space-y-3"><Input label="Bodycam suchen" value={search} onChange={e => setSearch(e.target.value)} /><Select label="Bodycam" value={clipId} onValueChange={setClipId} options={[{ value: '', label: 'Clip wählen' }, ...(clips.data ?? []).map(c => ({ value: c.id, label: c.title }))]} />{clips.error && <p className="text-sm text-red-300">{clips.error}</p>}<p className="text-xs text-[#909090]">Die ursprünglichen Bodycam-Zugriffsrechte gelten auch für diese Verknüpfung.</p><Button size="sm" loading={loading} disabled={!clipId} onClick={async () => { try { await execute(`/api/corruption-checks/${report.id}/evidence`, { method: 'POST', body: JSON.stringify({ clipId }) }); setChooseClip(false); setClipId(''); await onChanged() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Verknüpfen fehlgeschlagen') } }}>Clip verknüpfen</Button></div>}
    {message && <p role="status" className="text-sm text-[#c4c4c4]">{message}</p>}
    {preview && <Modal open onClose={() => setPreview(null)} title={preview.title} size="xl">{preview.mimeType?.startsWith('image/') ? <Image unoptimized src={fileUrl(preview)} width={1200} height={900} alt={preview.title} className="max-h-[65vh] w-full object-contain" /> : <><video controls className="max-h-[60vh] w-full" src={fileUrl(preview)} onError={() => setMessage('Video nicht verfügbar oder keine Bodycam-Berechtigung.')} /><p className="mt-2 text-xs text-[#909090]">Bei verknüpften Clips ist die Bodycam-Berechtigung erforderlich.</p></>}</Modal>}
  </section>
}

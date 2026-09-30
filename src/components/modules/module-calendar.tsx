'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Clock, MapPin, Megaphone, Plus, RefreshCw, Trash2, User as UserIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useHiddenIds, useUndoable } from '@/hooks/use-undoable'
import { useToast } from '@/components/ui/toast'
import { cn, toLocalDateTimeInput } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import { useUrlState } from '@/hooks/use-url-state'

export type ModuleCalendarKey = 'ACADEMY' | 'HR' | 'SRU' | 'AIR_SUPPORT' | 'DETECTIVE' | 'INTERNAL_AFFAIRS' | 'LAD'

interface Agent { id: string; firstName: string; lastName: string; badgeNumber: string }

interface CalendarEvent {
  id: string
  module: ModuleCalendarKey | null
  title: string
  description: string | null
  type: string
  startsAt: string
  endsAt: string | null
  location: string | null
  discordAnnouncement: boolean
  agent: Agent | null
}

interface EventTypeOption { value: string; label: string }

interface ModuleCalendarProps {
  module: ModuleCalendarKey
  title: string
  description: string
  emptyLabel: string
  createToastTitle: string
  deleteToastTitle: string
  eventTypes: EventTypeOption[]
  defaultType: string
  color: string
  canManage: boolean
}

function localDateTimeValue(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setMinutes(0, 0, 0)
  return toLocalDateTimeInput(date)
}

function eventTypeLabel(type: string, eventTypes: EventTypeOption[]) {
  return eventTypes.find((o) => o.value === type)?.label ?? type
}

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function timeRange(start: string, end: string | null) {
  const s = new Date(start)
  const sStr = s.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (!end) return sStr
  const e = new Date(end)
  const sameDay = s.toDateString() === e.toDateString()
  const eStr = e.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `${sStr} – ${eStr}` : `${sStr} → ${e.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} ${eStr}`
}

function relativeDay(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((d.getTime() - now.setHours(0, 0, 0, 0)) / 86400000)
  if (diffDays === 0) return 'Heute'
  if (diffDays === 1) return 'Morgen'
  if (diffDays === -1) return 'Gestern'
  if (diffDays > 1 && diffDays < 7) return `in ${diffDays} Tagen`
  if (diffDays < 0 && diffDays > -7) return `vor ${Math.abs(diffDays)} Tagen`
  return null
}

function DateBadge({ iso, color }: { iso: string; color: string }) {
  const d = new Date(iso)
  return (
      <div
          className="flex h-[58px] w-[58px] flex-col items-center justify-center rounded-[10px] border shrink-0"
          style={{ borderColor: `${color}55`, backgroundColor: `${color}10` }}
      >
        <span className="text-[11px] uppercase font-bold tracking-wider" style={{ color }}>{MONTHS_DE[d.getMonth()]}</span>
        <span className="text-[20px] font-bold leading-none text-white">{d.getDate()}</span>
        <span className="text-[11px] text-[#98989d] mt-0.5">{DAYS_DE[d.getDay()]}</span>
      </div>
  )
}

export function ModuleCalendar({
                                 module, title, description, emptyLabel, createToastTitle, deleteToastTitle,
                                 eventTypes, defaultType, color, canManage,
                               }: ModuleCalendarProps) {
  const { data: events, loading, refetch } = useFetch<CalendarEvent[]>(`/api/calendar-events?module=${module}`)
  const { hidden: hiddenEvents, hide: hideEvent, show: showEvent } = useHiddenIds()
  const runUndoable = useUndoable()
  const { data: agents } = useFetch<Agent[]>(canManage ? '/api/agents' : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useUrlState<'upcoming' | 'past' | 'all'>('filter', 'upcoming')
  const [nowMs, setNowMs] = useState<number | null>(null)
  const [form, setForm] = useState({
    title: '', description: '', type: defaultType, startsAt: localDateTimeValue(),
    endsAt: '', location: '', agentId: '', discordAnnouncement: false,
  })

  const agentOptions = useMemo(() => [
    { value: '', label: 'Kein Agent-Bezug' },
    ...(agents ?? []).map((o) => ({
      value: o.id,
      label: `${o.firstName} ${o.lastName} #${displayBadgeNumber(o.badgeNumber)}`,
    })),
  ], [agents])

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now())
    updateNow()
    const interval = window.setInterval(updateNow, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const { upcoming, past } = useMemo(() => {
    const now = nowMs ?? 0
    const list = (events ?? []).filter((e) => !hiddenEvents.has(e.id))
    const upcoming = list.filter((e) => new Date(e.startsAt).getTime() >= now).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
    const past = list.filter((e) => new Date(e.startsAt).getTime() < now).sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt))
    return { upcoming, past }
  }, [events, hiddenEvents, nowMs])

  const displayed = filter === 'upcoming' ? upcoming : filter === 'past' ? past : [...upcoming, ...past]

  const createEvent = async () => {
    if (!form.title.trim() || !form.startsAt) return
    try {
      await execute('/api/calendar-events', {
        method: 'POST',
        body: JSON.stringify({
          ...form, module,
          description: form.description.trim() || null,
          // Ortszeit aus dem Formular → echter Zeitstempel. Roh gesendet las der Server
          // „20:00“ in seiner Zeitzone (UTC) – der Termin stand dann bei allen auf 22:00.
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          location: form.location.trim() || null,
          agentId: form.agentId || null,
        }),
      })
      addToast({ type: 'success', title: createToastTitle })
      setModalOpen(false)
      setForm({ title: '', description: '', type: defaultType, startsAt: localDateTimeValue(), endsAt: '', location: '', agentId: '', discordAnnouncement: false })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Termin konnte nicht erstellt werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteEvent = (event: CalendarEvent) => {
    runUndoable({
      title: deleteToastTitle,
      message: event.title,
      apply: () => hideEvent(event.id),
      revert: () => showEvent(event.id),
      commit: async () => {
        await execute(`/api/calendar-events/${event.id}`, { method: 'DELETE' })
        await refetch()
      },
      errorTitle: 'Termin konnte nicht gelöscht werden',
    })
  }

  if (loading) return <PageLoader />

  return (
      <div className="space-y-5">
        <PageHeader
            title={title}
            description={description}
            action={(
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={refetch}><RefreshCw size={13} /> Aktualisieren</Button>
                  {canManage && <Button size="sm" onClick={() => setModalOpen(true)}><Plus size={13} /> Termin</Button>}
                </div>
            )}
        />

        {/* KPI Strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-panel-elevated rounded-[12px] border border-[#38383a]/45 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-[#98989d] font-semibold">Kommend</p>
            <p className="mt-1 text-[22px] font-bold text-white">{upcoming.length}</p>
          </div>
          <div className="glass-panel-elevated rounded-[12px] border border-[#38383a]/45 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-[#98989d] font-semibold">Vergangen</p>
            <p className="mt-1 text-[22px] font-bold text-white">{past.length}</p>
          </div>
          <div className="glass-panel-elevated rounded-[12px] border border-[#38383a]/45 p-3.5">
            <p className="text-[11px] uppercase tracking-wider text-[#98989d] font-semibold">Nächster</p>
            <p className="mt-1 text-[13.5px] font-semibold text-white truncate">{upcoming[0] ? (relativeDay(upcoming[0].startsAt) ?? new Date(upcoming[0].startsAt).toLocaleDateString('de-DE')) : '—'}</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5">
          {[
            { id: 'upcoming' as const, label: `Kommend (${upcoming.length})` },
            { id: 'past' as const, label: `Vergangen (${past.length})` },
            { id: 'all' as const, label: 'Alle' },
          ].map((f) => (
              <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                      'inline-flex h-8 items-center rounded-[8px] border px-3 text-[12px] font-medium transition-colors',
                      filter === f.id
                          ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                          : 'border-[#38383a]/60 bg-[#1c1c1e]/55 text-[#98989d] hover:border-[#48484a] hover:text-white',
                  )}
              >
                {f.label}
              </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {displayed.map((event) => {
            const rel = relativeDay(event.startsAt)
            const isPast = new Date(event.startsAt).getTime() < (nowMs ?? 0)
            return (
                <div
                    key={event.id}
                    className={cn(
                        'glass-panel-elevated rounded-[14px] border p-4 transition-all hover:translate-y-[-1px] group',
                        isPast ? 'border-[#38383a]/30 opacity-70' : 'border-[#38383a]/45 hover:border-[#d4d4d4]/30',
                    )}
                >
                  <div className="flex items-start gap-3.5">
                    <DateBadge iso={event.startsAt} color={color} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span
                            className="rounded-[5px] border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                            style={{ borderColor: `${color}40`, backgroundColor: `${color}14`, color }}
                        >
                          {eventTypeLabel(event.type, eventTypes)}
                        </span>
                            {rel && (
                                <span className="rounded-[5px] bg-[#2c2c2e] px-1.5 py-0.5 text-[11px] font-semibold text-[#98989d]">
                            {rel}
                          </span>
                            )}
                            {event.discordAnnouncement && (
                                <Megaphone size={12} className="text-[#38bdf8]" />
                            )}
                          </div>
                          <h3 className="text-[14px] font-semibold text-white leading-snug">{event.title}</h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#98989d]">
                            <span className="inline-flex items-center gap-1"><Clock size={11} /> {timeRange(event.startsAt, event.endsAt)}</span>
                            {event.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {event.location}</span>}
                          </div>
                        </div>
                        {canManage && (
                            <button
                                type="button"
                                onClick={() => deleteEvent(event)}
                                className="rounded-[6px] p-1.5 text-[#8e8e93] opacity-0 group-hover:opacity-100 transition-all hover:bg-[#321218]/60 hover:text-[#fca5a5]"
                                title="Löschen"
                            >
                              <Trash2 size={13} />
                            </button>
                        )}
                      </div>
                      {event.description && <p className="mt-2.5 text-[12px] leading-relaxed text-[#c7c7cc] line-clamp-3">{event.description}</p>}
                      {event.agent && (
                          <Link
                              href={`/agents/${event.agent.id}`}
                              className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] text-[#d4d4d4] hover:text-white transition-colors"
                          >
                            <UserIcon size={11} /> {event.agent.firstName} {event.agent.lastName} #{displayBadgeNumber(event.agent.badgeNumber)}
                          </Link>
                      )}
                    </div>
                  </div>
                </div>
            )
          })}
        </div>

        {displayed.length === 0 && (
            <div className="glass-panel-elevated rounded-[14px] p-14 text-center">
              <div className="inline-flex rounded-full p-4 mb-3" style={{ backgroundColor: `${color}12` }}>
                <CalendarDays size={26} style={{ color }} />
              </div>
              <p className="text-[13px] text-[#98989d]">
                {filter === 'upcoming' ? 'Keine kommenden Termine' : filter === 'past' ? 'Keine vergangenen Termine' : emptyLabel}
              </p>
              {canManage && filter === 'upcoming' && (
                  <Button size="sm" variant="secondary" className="mt-4" onClick={() => setModalOpen(true)}>
                    <Plus size={13} /> Termin erstellen
                  </Button>
              )}
            </div>
        )}

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`${title}: Termin erstellen`}>
          <div className="space-y-4">
            <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <Select label="Art" value={form.type} onValueChange={(type) => setForm({ ...form, type })} options={eventTypes} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              <Input label="Ende optional" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
            <Input label="Ort optional" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Select label="Agent-Bezug" value={form.agentId} onValueChange={(agentId) => setForm({ ...form, agentId })} options={agentOptions} />
            <Textarea label="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            <label className="flex items-center gap-2 rounded-[9px] border border-[#38383a]/60 bg-[#1c1c1e] px-3 py-2 text-[12.5px] text-[#c7c7cc]">
              <input type="checkbox" checked={form.discordAnnouncement} onChange={(e) => setForm({ ...form, discordAnnouncement: e.target.checked })} />
              Discord-Ankündigung senden
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
              <Button size="sm" onClick={createEvent} disabled={!form.title.trim() || !form.startsAt}>Erstellen</Button>
            </div>
          </div>
        </Modal>
      </div>
  )
}

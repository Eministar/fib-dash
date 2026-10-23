'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChevronRight, Crosshair, Package, Search } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Card } from '@/components/ui/card'
import { ListSkeleton } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { useUrlState } from '@/hooks/use-url-state'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { hasPermission } from '@/lib/permissions'
import { itemLabel } from '@/lib/storage-logs/storage-logs'
import { cn, formatDateTime, formatRelativeTime } from '@/lib/utils'

type AgentInfo = { id: string; firstName: string; lastName: string; badgeNumber: string; status: string; rank: { name: string; color: string } }
type SummaryRow = {
  key: string
  agentId: string | null
  actorName: string | null
  outEntries: number
  outItems: number
  outWeapons: number
  inItems: number
  lastOut: string | null
  lastActivity: string | null
  alerts: number
  agent: AgentInfo | null
}
type Alert = {
  slug: string; actorName: string; agentId: string | null; weaponCount: number; itemCount: number
  windowStart: string; windowEnd: string; entrySlugs: string[]; createdAt: string
  agent: { firstName: string; lastName: string; badgeNumber: string } | null
}
type Summary = { rows: SummaryRow[]; alerts: Alert[]; configured: { logChannel: boolean; alertChannel: boolean } }
type Entry = { slug: string; direction: 'IN' | 'OUT'; actorName: string; item: string; quantity: number; isWeapon: boolean; storage: string; occurredAt: string }

const RANGES = [
  { id: '7d', label: '7 Tage' },
  { id: '30d', label: '30 Tage' },
  { id: '90d', label: '90 Tage' },
  { id: 'all', label: 'Alles' },
] as const
type RangeId = (typeof RANGES)[number]['id']

function rowName(row: SummaryRow) {
  return row.agent ? `${row.agent.firstName} ${row.agent.lastName}` : row.actorName ?? 'Unbekannt'
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: readonly { id: T; label: string }[]; label: string }) {
  return (
    <div className="inline-flex gap-[2px] rounded-[9px] bg-[#1c1c1e] p-[3px]" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn('rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors', value === option.id ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]' : 'text-[#98989d] hover:text-white')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function StorageLogsWorkspace() {
  const { user } = useAuth()
  const allowed = hasPermission(user, 'storage-logs:view')
  const [range, setRange] = useUrlState<RangeId>('range', '30d', RANGES.map((r) => r.id))
  const [agentId, setAgentId] = useUrlState('agent', '')
  const [actor, setActor] = useUrlState('actor', '')
  const [alertSlug] = useUrlState('alert', '')
  const [search, setSearch] = useUrlState('q', '')
  const { data, loading, error } = useFetch<Summary>(allowed ? `/api/storage-logs?range=${range}` : null)

  const activeAlert = data?.alerts.find((alert) => alert.slug === alertSlug) ?? null
  // Aus einem Warnungs-Link: die betroffene Person direkt öffnen.
  const selectedAgent = agentId || (activeAlert && !actor ? activeAlert.agentId ?? '' : '')
  const selectedActor = actor || (activeAlert && !activeAlert.agentId && !agentId ? activeAlert.actorName : '')
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.rows ?? []).filter((row) => !term || rowName(row).toLowerCase().includes(term))
  }, [data?.rows, search])
  const selectedRow = (data?.rows ?? []).find((row) => (selectedAgent ? row.agentId === selectedAgent : selectedActor ? row.actorName === selectedActor && !row.agentId : false)) ?? null

  if (!allowed) return <UnauthorizedContent />

  const select = (row: SummaryRow) => {
    setAgentId(row.agentId ?? '')
    setActor(row.agentId ? '' : row.actorName ?? '')
  }

  return (
    <div className="mx-auto max-w-7xl pb-6">
      <PageHeader
        title="Lagerlogs"
        description="Ein- und Auslagerungen aus dem Fraklager, je Agent. Auffällige Entnahmen lösen eine Warnung aus."
        action={<Segmented value={range} onChange={setRange} options={RANGES} label="Zeitraum" />}
      />

      {data && !data.configured.logChannel && (
        <Card className="mb-4 border border-[#ffb340]/30 bg-[#ffb340]/[0.06] text-[13px] text-[#ffd18a]">
          Noch kein Lager-Channel eingestellt. Unter Administration → Einstellungen → Lagerlogs den Channel des Webhooks wählen.
        </Card>
      )}

      {(data?.alerts.length ?? 0) > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-white">
            <AlertTriangle className="h-4 w-4 text-[#ff6961]" aria-hidden />
            Warnungen im Zeitraum
          </h2>
          <ul className="divide-y divide-white/[0.06]">
            {data!.alerts.map((alert) => {
              const name = alert.agent ? `${alert.agent.firstName} ${alert.agent.lastName}` : alert.actorName
              const href = `/leadership/storage?range=${range}&alert=${alert.slug}${alert.agentId ? `&agent=${alert.agentId}` : `&actor=${encodeURIComponent(alert.actorName)}`}`
              return (
                <li key={alert.slug}>
                  <Link href={href} className={cn('-mx-2 flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 text-[13px] hover:bg-[#2c2c2e]', alert.slug === alertSlug && 'bg-[#ff453a]/10')}>
                    <span className="min-w-0">
                      <span className="font-medium text-white">{name}</span>
                      <span className="text-[#98989d]"> · {alert.weaponCount} Waffen · {alert.itemCount} Gegenstände</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-[#8e8e93]"><span className="font-mono">{alert.slug}</span> · {formatRelativeTime(alert.createdAt)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="p-0">
          <div className="border-b border-white/[0.06] p-3">
            <label className="relative block">
              <span className="sr-only">Agent suchen</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e8e93]" aria-hidden />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Agent suchen …" className="h-[32px] w-full rounded-[7px] border border-[#48484a] bg-[#161617] pl-8 pr-3 text-[13px] text-white outline-none placeholder:text-[#8e8e93] focus:border-[#0a84ff]" />
            </label>
          </div>
          {loading && !data ? <div className="p-3"><ListSkeleton rows={6} compact /></div> : error ? (
            <p role="alert" className="p-4 text-[13px] text-[#fca5a5]">{error}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-[#8e8e93]">Keine Lagervorgänge im Zeitraum.</p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-white/[0.05] overflow-auto">
              {rows.map((row) => {
                const active = row === selectedRow
                return (
                  <li key={row.key}>
                    <button type="button" onClick={() => select(row)} aria-current={active || undefined} className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#2c2c2e]', active && 'bg-[#2c2c2e]')}>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-white">{rowName(row)}</span>
                          {row.alerts > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#ff6961]" aria-label={`${row.alerts} Warnungen`} />}
                        </span>
                        <span className="block truncate text-[11.5px] text-[#8e8e93]">
                          {row.agent ? <><span style={{ color: row.agent.rank.color }}>{row.agent.rank.name}</span> · {displayBadgeNumber(row.agent.badgeNumber)}</> : 'Keinem Agent zugeordnet'}
                          {row.lastOut ? ` · zuletzt ${formatRelativeTime(row.lastOut)}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[12px] tabular-nums">
                        <span className="block text-white">{row.outItems} raus</span>
                        <span className={cn('block', row.outWeapons > 0 ? 'text-[#ff9f0a]' : 'text-[#8e8e93]')}>{row.outWeapons} Waffen</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#636366]" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div>
          {selectedRow ? (
            <AgentStorageLog row={selectedRow} range={range} highlight={activeAlert?.entrySlugs ?? []} />
          ) : (
            <Card className="py-14 text-center text-[13px] text-[#8e8e93]">
              <Package className="mx-auto mb-3 h-6 w-6 text-[#636366]" aria-hidden />
              Agent links auswählen, um zu sehen, was er wann ein- und ausgelagert hat.
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function AgentStorageLog({ row, range, highlight }: { row: SummaryRow; range: RangeId; highlight: string[] }) {
  const [direction, setDirection] = useUrlState<'OUT' | 'ALL'>('dir', 'OUT', ['OUT', 'ALL'])
  const query = new URLSearchParams({ range })
  if (row.agentId) query.set('agentId', row.agentId)
  else if (row.actorName) query.set('actor', row.actorName)
  if (direction === 'OUT') query.set('direction', 'OUT')
  const { data, loading } = useFetch<Entry[]>(`/api/storage-logs/entries?${query}`)

  const days = useMemo(() => {
    const groups = new Map<string, Entry[]>()
    for (const entry of data ?? []) {
      const day = new Date(entry.occurredAt).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })
      groups.set(day, [...(groups.get(day) ?? []), entry])
    }
    return [...groups.entries()]
  }, [data])

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold text-white">{rowName(row)}</h2>
          <p className="text-[12px] text-[#98989d]">
            {row.outEntries} Entnahmen · {row.outItems} Gegenstände · <span className={row.outWeapons ? 'text-[#ff9f0a]' : ''}>{row.outWeapons} Waffen</span> · {row.inItems} eingelagert
          </p>
          {row.agent && <Link href={`/agents/${row.agent.id}`} className="text-[12px] text-[#0a84ff] hover:underline">Personalakte öffnen</Link>}
        </div>
        <Segmented value={direction} onChange={setDirection} options={[{ id: 'OUT', label: 'Entnahmen' }, { id: 'ALL', label: 'Alles' }] as const} label="Richtung" />
      </div>

      {loading && !data ? <ListSkeleton rows={5} compact /> : days.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#8e8e93]">Keine Einträge.</p>
      ) : (
        <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
          {days.map(([day, entries]) => (
            <section key={day}>
              <h3 className="sticky top-0 mb-1 bg-[#1c1c1e] py-1 text-[11.5px] font-semibold uppercase tracking-wide text-[#8e8e93]">{day}</h3>
              <ul className="space-y-0.5">
                {entries.map((entry) => {
                  const out = entry.direction === 'OUT'
                  const Icon = out ? ArrowUpFromLine : ArrowDownToLine
                  return (
                    <li key={entry.slug}>
                      <Link href={`/leadership/storage/${entry.slug}`} className={cn('-mx-2 flex items-center gap-3 rounded-[8px] px-2 py-1.5 hover:bg-[#2c2c2e]', highlight.includes(entry.slug) && 'bg-[#ff453a]/10 ring-1 ring-inset ring-[#ff453a]/40')}>
                        <span className="w-11 shrink-0 text-[12px] tabular-nums text-[#8e8e93]">{new Date(entry.occurredAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', out ? 'text-[#ff9f0a]' : 'text-[#30d158]')} aria-label={out ? 'Entnahme' : 'Einlagerung'} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-white">
                          <span className="tabular-nums">{entry.quantity}×</span> {itemLabel(entry.item)}
                          {entry.isWeapon && <Crosshair className="ml-1.5 inline h-3 w-3 text-[#ff9f0a]" aria-label="Waffe" />}
                          <span className="text-[#8e8e93]"> · {entry.storage}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-[#636366]">{entry.slug}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          <p className="text-[11.5px] text-[#636366]">Zeiten in deiner Ortszeit · Stand {formatDateTime(new Date())}</p>
        </div>
      )}
    </Card>
  )
}

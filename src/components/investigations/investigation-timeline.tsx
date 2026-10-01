'use client'

import { useMemo, useState } from 'react'
import { Camera, FileText, Flag, Link2, Package, Video, type LucideIcon } from 'lucide-react'

import { SectionCard } from '@/components/ui/section-card'
import { useFetch } from '@/hooks/use-fetch'
import {
  TIMELINE_KINDS,
  TIMELINE_KIND_LABELS,
  buildCaseTimeline,
  groupTimelineByDay,
  type TimelineCustodyEvent,
  type TimelineItem,
  type TimelineKind,
} from '@/lib/case-timeline'
import { INVESTIGATION_ENTRY_KIND_LABELS } from '@/lib/investigations'
import { cn } from '@/lib/utils'
import type { InvestigationDetail } from '@/components/investigations/types'

const KIND_STYLE: Record<TimelineKind, { icon: LucideIcon; dot: string }> = {
  milestone: { icon: Flag, dot: 'bg-[#8e8e93]' },
  entry: { icon: FileText, dot: 'bg-[#a78bfa]' },
  clip: { icon: Video, dot: 'bg-[#64d2ff]' },
  evidence: { icon: Package, dot: 'bg-[#ffd60a]' },
  photo: { icon: Camera, dot: 'bg-[#30d158]' },
  custody: { icon: Link2, dot: 'bg-[#ff9f0a]' },
}

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

/**
 * Alle datierten Bestandteile einer Akte auf einer Achse – Einsätze, Clips,
 * Asservate, Bilder und Übergaben – nach Tagen gruppiert und filterbar.
 */
export function InvestigationTimeline({
  investigation,
  onOpen,
}: {
  investigation: InvestigationDetail
  onOpen: (item: TimelineItem) => void
}) {
  const { data: custody } = useFetch<TimelineCustodyEvent[]>(`/api/investigations/${investigation.id}/custody`)
  const [hidden, setHidden] = useState<Set<TimelineKind>>(() => new Set())

  const items = useMemo(
    () => buildCaseTimeline(investigation, INVESTIGATION_ENTRY_KIND_LABELS, custody ?? []),
    [custody, investigation],
  )
  const counts = useMemo(() => {
    const result = Object.fromEntries(TIMELINE_KINDS.map((kind) => [kind, 0])) as Record<TimelineKind, number>
    for (const item of items) result[item.kind] += 1
    return result
  }, [items])
  const groups = useMemo(() => groupTimelineByDay(items.filter((item) => !hidden.has(item.kind))), [hidden, items])

  const toggle = (kind: TimelineKind) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  return (
    <SectionCard title="Zeitstrahl" count={items.length}>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Arten filtern">
        {TIMELINE_KINDS.filter((kind) => counts[kind] > 0).map((kind) => {
          const active = !hidden.has(kind)
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(kind)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                active ? 'border-[#48484a] text-[#f5f5f7]' : 'border-[#2c2c2e] text-[#8e8e93] line-through',
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', KIND_STYLE[kind].dot, !active && 'opacity-40')} />
              {TIMELINE_KIND_LABELS[kind]}
              <span className="font-mono text-[11px] text-[#8e8e93]">{counts[kind]}</span>
            </button>
          )
        })}
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-[#8e8e93]">Nichts für die gewählten Filter.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.day}>
              <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8e8e93]">
                {dayFormat.format(new Date(group.items[0].at))}
              </h3>
              <ol className="relative ml-[54px] border-l border-[#2c2c2e]">
                {group.items.map((item) => {
                  const style = KIND_STYLE[item.kind]
                  const Icon = style.icon
                  const clickable = item.kind !== 'milestone'
                  return (
                    <li key={item.id} className="relative pb-3 pl-5 last:pb-0">
                      <time
                        dateTime={item.at}
                        className="absolute -left-[54px] top-0.5 w-[44px] text-right font-mono text-[11.5px] text-[#8e8e93]"
                        title={item.approximate ? 'Erfassungszeitpunkt – der genaue Zeitpunkt ist unbekannt' : undefined}
                      >
                        {item.approximate ? '≈' : ''}
                        {timeFormat.format(new Date(item.at))}
                      </time>
                      <span
                        className={cn('absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full ring-4 ring-[#1c1c1e]', style.dot)}
                        aria-hidden
                      />
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => onOpen(item)}
                        className={cn(
                          '-mx-2 -my-1 flex w-[calc(100%+16px)] items-start gap-2 rounded-[8px] px-2 py-1 text-left',
                          clickable && 'hover:bg-[#2c2c2e]/60',
                        )}
                      >
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8e8e93]" aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-white">{item.title}</span>
                          <span className="block text-[11.5px] text-[#98989d]">
                            {TIMELINE_KIND_LABELS[item.kind]}
                            {item.subtitle ? ` · ${item.subtitle}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

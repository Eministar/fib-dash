'use client'

import { use, useMemo } from 'react'
import Image from 'next/image'
import { FileDown, History, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SearchInput } from '@/components/ui/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { useFetch } from '@/hooks/use-fetch'
import { useUrlState } from '@/hooks/use-url-state'
import { useTrackRecentItem } from '@/hooks/use-recent-items'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn, formatDate, formatDateTime, getStatusLabel } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import { matchesSearch } from '@/lib/search-match'
import {
  DEFAULT_TIMELINE_CATEGORIES,
  TIMELINE_CATEGORIES,
  TIMELINE_CATEGORY_LABELS,
  parseTimelineCategories,
  type TimelineCategory,
  type TimelineEntry,
  type TimelineResponse,
  type TimelineTone,
} from '@/lib/agent-timeline'

const RANGES = [
  { value: 'all', label: 'Gesamter Zeitraum' },
  { value: '30', label: 'Letzte 30 Tage' },
  { value: '90', label: 'Letzte 90 Tage' },
  { value: '365', label: 'Letzte 12 Monate' },
] as const
type RangeValue = (typeof RANGES)[number]['value']
const RANGE_VALUES: RangeValue[] = RANGES.map((option) => option.value)

const TONE_DOT: Record<TimelineTone, string> = {
  positive: 'bg-[#30d158] timeline-dot-positive',
  negative: 'bg-[#ff453a] timeline-dot-negative',
  neutral: 'bg-[#8e8e93] timeline-dot-neutral',
}

const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })

function monthKey(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}`
}

export default function AgentTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useAuth()
  const canView = hasPermission(user, 'agents:view')
  const { data, loading, error, refetch } = useFetch<TimelineResponse>(canView ? `/api/agents/${id}/timeline` : null)

  const [typesParam, setTypesParam] = useUrlState('types', '')
  const [search, setSearch] = useUrlState('q', '')
  const [range, setRange] = useUrlState<RangeValue>('range', 'all', RANGE_VALUES)

  const selected = useMemo(() => new Set(parseTimelineCategories(typesParam)), [typesParam])
  const isDefaultSelection =
    selected.size === DEFAULT_TIMELINE_CATEGORIES.length && DEFAULT_TIMELINE_CATEGORIES.every((category) => selected.has(category))

  useTrackRecentItem(data ? {
    href: `/agents/${id}/timeline`,
    title: `Personalakte ${data.agent.firstName} ${data.agent.lastName}`,
    subtitle: `#${displayBadgeNumber(data.agent.badgeNumber)}`,
    kind: 'agent',
  } : null)

  const items = useMemo(() => data?.items ?? [], [data])

  // Zeitraum und Suche wirken auch auf die Zähler an den Chips – so sieht
  // man, was ein Klick auf eine Kategorie tatsächlich hinzufügt.
  const inRange = useMemo(() => {
    if (range === 'all') return items
    // eslint-disable-next-line react-hooks/purity -- „jetzt“ ist hier gewollt; die Liste wird bei Filterwechsel neu berechnet.
    const since = Date.now() - Number(range) * 24 * 60 * 60 * 1000
    return items.filter((item) => new Date(item.occurredAt).getTime() >= since)
  }, [items, range])

  const searched = useMemo(
    () => inRange.filter((item) => matchesSearch(search, [
      item.title,
      item.description,
      TIMELINE_CATEGORY_LABELS[item.category],
      ...item.details.map((entry) => entry.value),
    ])),
    [inRange, search],
  )

  const counts = useMemo(() => {
    const result = Object.fromEntries(TIMELINE_CATEGORIES.map((category) => [category, 0])) as Record<TimelineCategory, number>
    for (const item of searched) result[item.category] += 1
    return result
  }, [searched])

  const visible = useMemo(() => searched.filter((item) => selected.has(item.category)), [searched, selected])

  const groups = useMemo(() => {
    const result: { key: string; label: string; items: TimelineEntry[] }[] = []
    for (const item of visible) {
      const key = monthKey(item.occurredAt)
      const last = result[result.length - 1]
      if (last?.key === key) last.items.push(item)
      else result.push({ key, label: MONTH.format(new Date(item.occurredAt)), items: [item] })
    }
    return result
  }, [visible])

  const toggle = (category: TimelineCategory) => {
    const next = new Set(selected)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    const list = TIMELINE_CATEGORIES.filter((entry) => next.has(entry))
    const isDefault = list.length === DEFAULT_TIMELINE_CATEGORIES.length && list.every((entry) => DEFAULT_TIMELINE_CATEGORIES.includes(entry))
    // Leere Auswahl ergäbe eine leere Akte – dann lieber zurück zum Standard.
    setTypesParam(list.length === 0 || isDefault ? '' : list.join(','))
  }

  const resetFilters = () => {
    setTypesParam('')
    setSearch('')
    setRange('all')
  }

  const exportPdf = () => {
    if (!data) return
    // Der Dokumenttitel wird im Druckdialog als Dateiname vorgeschlagen.
    const previousTitle = document.title
    document.title = `Personalakte ${data.agent.lastName}, ${data.agent.firstName} (${displayBadgeNumber(data.agent.badgeNumber)})`
    const restore = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  if (!canView) return <UnauthorizedContent />
  if (loading && !data) return <PageLoader withHeader />
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState
          icon={History}
          title="Die Personalakte konnte nicht geladen werden"
          hint={error ?? undefined}
          action={<Button size="sm" onClick={refetch}>Erneut versuchen</Button>}
        />
      </div>
    )
  }

  const { agent } = data
  const fullName = `${agent.firstName} ${agent.lastName}`
  const filtersActive = !isDefaultSelection || Boolean(search.trim()) || range !== 'all'
  const rangeLabel = RANGES.find((option) => option.value === range)?.label ?? ''
  const categorySummary = TIMELINE_CATEGORIES.filter((category) => selected.has(category))
    .map((category) => TIMELINE_CATEGORY_LABELS[category])
    .join(', ')

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="print:hidden">
        <PageHeader
          breadcrumbs={[
            { label: 'Agents', href: '/agents' },
            { label: fullName, href: `/agents/${id}` },
            { label: 'Personalakte' },
          ]}
          title="Personalakte"
          description={`${fullName} · #${displayBadgeNumber(agent.badgeNumber)} · ${agent.rankName}`}
          action={
            <Button size="sm" onClick={exportPdf} disabled={visible.length === 0}>
              <FileDown size={14} />
              Als PDF exportieren
            </Button>
          }
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="In der Akte suchen …" label="Personalakte durchsuchen" />
            <div className="w-full sm:w-52">
              <Select
                value={range}
                onValueChange={(value) => setRange(value as RangeValue)}
                options={RANGES.map((option) => ({ value: option.value, label: option.label }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategorien">
            {TIMELINE_CATEGORIES.map((category) => {
              const active = selected.has(category)
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(category)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                    active
                      ? 'border-transparent bg-[#f5f5f7] text-[#1c1c1e]'
                      : 'border-[#38383a] text-[#98989d] hover:border-[#48484a] hover:text-[#f5f5f7]',
                  )}
                >
                  {TIMELINE_CATEGORY_LABELS[category]}
                  <span className={cn('tabular-nums', active ? 'text-[#1c1c1e]/55' : 'text-[#8e8e93]')}>{counts[category]}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[#8e8e93]">
            <span>{visible.length} von {items.length} Einträgen</span>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 text-[#98989d] transition-colors hover:text-white"
              >
                <RotateCcw size={13} />
                Filter zurücksetzen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="timeline-print">
        {/* Briefkopf – nur im Ausdruck bzw. PDF */}
        <header className="hidden print:block">
          <div className="timeline-print-rule flex items-center gap-4 border-b pb-4">
            <Image src="/shield.webp" alt="" width={56} height={56} className="rounded-full" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">Federal Investigation Bureau</p>
              <h1 className="text-[22px] font-semibold">Personalakte · {fullName}</h1>
            </div>
          </div>
          <dl className="grid grid-cols-4 gap-x-8 gap-y-1.5 py-4 text-[12px]">
            <div><dt className="timeline-print-muted">Dienstnummer</dt><dd className="font-medium">#{displayBadgeNumber(agent.badgeNumber)}</dd></div>
            <div><dt className="timeline-print-muted">Rang</dt><dd className="font-medium">{agent.rankName}</dd></div>
            <div><dt className="timeline-print-muted">Status</dt><dd className="font-medium">{getStatusLabel(agent.status)}</dd></div>
            <div><dt className="timeline-print-muted">Eingestellt</dt><dd className="font-medium">{formatDate(agent.hireDate)}</dd></div>
          </dl>
          <p className="timeline-print-muted timeline-print-rule mb-5 border-b pb-3 text-[11px]">
            Auszug: {categorySummary} · {rangeLabel}
            {search.trim() ? ` · Suche „${search.trim()}“` : ''} · {visible.length} Einträge · erstellt am {formatDateTime(new Date())}
            {user?.displayName ? ` von ${user.displayName}` : ''}
          </p>
        </header>

        {visible.length === 0 ? (
          <EmptyState
            icon={History}
            title={items.length === 0 ? 'Noch keine Akteneinträge vorhanden' : 'Keine Einträge für diese Auswahl'}
            hint={items.length === 0 ? undefined : 'Andere Kategorien wählen oder den Zeitraum erweitern.'}
            action={items.length > 0 && filtersActive ? <Button size="sm" variant="secondary" onClick={resetFilters}>Filter zurücksetzen</Button> : undefined}
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <h2 className="timeline-month-label mb-2 px-1 text-[12.5px] font-semibold text-[#8e8e93]">{group.label}</h2>
                <ol className="timeline-list overflow-hidden rounded-[12px] bg-[#1c1c1e]">
                  {group.items.map((item, index) => (
                    <li
                      key={item.id}
                      className={cn('timeline-entry flex gap-3.5 px-4 py-3.5', index > 0 && 'border-t border-[#38383a]/70')}
                    >
                      <span className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', TONE_DOT[item.tone])} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <h3 className="text-[13.5px] font-semibold text-[#f5f5f7]">{item.title}</h3>
                          <time dateTime={item.occurredAt} className="text-[12px] tabular-nums text-[#8e8e93]">
                            {formatDateTime(item.occurredAt)}
                          </time>
                        </div>
                        <p className="mt-0.5 text-[11.5px] text-[#8e8e93]">{TIMELINE_CATEGORY_LABELS[item.category]}</p>
                        {item.description && (
                          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[#c7c7cc]">{item.description}</p>
                        )}
                        {item.details.length > 0 && (
                          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                            {item.details.map((entry) => (
                              <div key={entry.label} className="flex gap-1.5">
                                <dt className="text-[#8e8e93]">{entry.label}:</dt>
                                <dd className="text-[#c7c7cc]">{entry.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

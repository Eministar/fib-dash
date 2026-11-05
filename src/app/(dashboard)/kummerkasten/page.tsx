'use client'

import Link from 'next/link'
import { EyeOff, ImageIcon, Inbox, MessageSquareWarning, User } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { useFetch } from '@/hooks/use-fetch'
import { useUrlState } from '@/hooks/use-url-state'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn, formatDateTime } from '@/lib/utils'
import { KUMMERKASTEN_STATUS_LABELS, KUMMERKASTEN_STATUS_VARIANT, type KummerkastenStatusValue } from '@/lib/kummerkasten/kummerkasten'

interface EntryRow {
  id: number
  number: string
  subject: string
  anonymous: boolean
  authorName: string | null
  status: KummerkastenStatusValue
  hasImage: boolean
  discordThreadId: string | null
  createdAt: string
}

type Filter = 'active' | KummerkastenStatusValue | 'all'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Offen & in Bearbeitung' },
  { value: 'OPEN', label: 'Offen' },
  { value: 'IN_PROGRESS', label: 'In Bearbeitung' },
  { value: 'DONE', label: 'Erledigt' },
  { value: 'all', label: 'Alle' },
]

export default function KummerkastenPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'kummerkasten:view')
  const { data, loading } = useFetch<EntryRow[]>(canView ? '/api/kummerkasten' : null)
  const [filter, setFilter] = useUrlState<Filter>('filter', 'active')

  if (!canView) return <UnauthorizedContent />
  if (loading && !data) return <PageLoader withHeader />

  const rows = (data ?? []).filter((row) =>
    filter === 'all' ? true : filter === 'active' ? row.status !== 'DONE' : row.status === filter,
  )
  const openCount = (data ?? []).filter((row) => row.status === 'OPEN').length

  return (
    <div>
      <PageHeader
        title="Kummerkasten"
        description="Kritik aus dem PD-Discord, anonym oder mit Namen. Vertraulich: nur für FIB-01."
        badge={openCount > 0 ? <Badge variant="warning">{openCount} offen</Badge> : undefined}
      />

      <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Status-Filter">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={cn(
              'rounded-[8px] px-3.5 py-[7px] text-[13px] font-medium transition-colors duration-100',
              filter === option.value ? 'bg-[#d4d4d4] text-[#1c1c1e]' : 'text-[#98989d] hover:bg-[#2c2c2e] hover:text-[#eee]',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={filter === 'all' ? Inbox : MessageSquareWarning}
          title={filter === 'all' ? 'Noch keine Einsendungen' : 'Keine Einsendungen in diesem Filter'}
          hint="Einsendungen kommen über das Kummerkasten-Panel im PD-Discord."
        />
      ) : (
        <ul className="glass-panel-elevated divide-y divide-[#38383a]/50 overflow-hidden rounded-[14px]">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/kummerkasten/${row.id}`}
                className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[#2c2c2e]/60 focus-visible:bg-[#2c2c2e]/60 focus-visible:outline-none"
              >
                <span className="w-[68px] shrink-0 font-mono text-[12px] text-[#8e8e93]">{row.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[#eee]">{row.subject}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[#8e8e93]">
                    {row.anonymous ? <EyeOff size={11} aria-hidden /> : <User size={11} aria-hidden />}
                    {row.anonymous ? 'Anonym' : row.authorName}
                    <span aria-hidden>·</span>
                    {formatDateTime(row.createdAt)}
                    {row.hasImage && <ImageIcon size={11} className="ml-1" aria-label="mit Foto" />}
                  </span>
                </span>
                <Badge variant={KUMMERKASTEN_STATUS_VARIANT[row.status]}>{KUMMERKASTEN_STATUS_LABELS[row.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

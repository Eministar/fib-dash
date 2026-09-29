'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, FileText, Lock, Pin, Plus, Table2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { SearchInput } from '@/components/ui/filter-bar'
import { Badge } from '@/components/ui/badge'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { PUBLICATION_STATUS, type PublicationKind, type PublicationStatus } from '@/lib/publications'
import { formatDate } from '@/lib/utils'

interface PublicationListItem {
  id: string
  slug: string
  kind: PublicationKind
  title: string
  summary: string | null
  status: PublicationStatus
  access: 'PUBLIC' | 'ROLES'
  listed: boolean
  pinned: boolean
  updatedAt: string
  createdBy: { displayName: string } | null
}

const STATUS_VARIANT = { DRAFT: 'default', PUBLISHED: 'success', ARCHIVED: 'warning' } as const

export default function PublicationsPage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'publications:manage')
  const { data, loading, error } = useFetch<PublicationListItem[]>(canManage ? '/api/publications' : null)
  const [search, setSearch] = useState('')
  const items = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data ?? []).filter((item) => !query || `${item.title} ${item.summary ?? ''}`.toLowerCase().includes(query))
  }, [data, search])

  if (!canManage) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-5xl pb-6">
      <PageHeader
        title="Aushänge"
        description="Schreiben und Tabellen veröffentlichen – öffentlich einsehbar auf dem Schwarzen Brett oder nur per Link."
        action={
          <div className="flex gap-2">
            <a href="/aushang" target="_blank" rel="noopener noreferrer" className="inline-flex h-[32px] items-center gap-1.5 rounded-[8px] bg-[#232323] px-3 text-[12.5px] font-medium text-[#f4f4f4] hover:bg-[#333333]"><ExternalLink size={13} /> Schwarzes Brett</a>
            <Link href="/publications/new" className="inline-flex h-[32px] items-center gap-1.5 rounded-[8px] bg-[#d4d4d4] px-3 text-[12.5px] font-medium text-[#181818] hover:bg-white"><Plus size={14} /> Neuer Aushang</Link>
          </div>
        }
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Aushänge durchsuchen" className="mb-4" />
      {error && <p role="alert" className="mb-4 text-[13px] text-[#fca5a5]">{error}</p>}
      {loading && !data
        ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-[12px] bg-[#1c1c1c]" />)}</div>
        : items.length === 0
          ? <p className="glass-panel-elevated rounded-[14px] px-5 py-10 text-center text-[13px] text-[#909090]">{search ? 'Keine Treffer.' : 'Noch keine Aushänge. Lege mit „Neuer Aushang“ ein Schreiben oder eine Tabelle an.'}</p>
          : (
            <ul className="glass-panel-elevated divide-y divide-[#2c2c2c] overflow-hidden rounded-[14px]">
              {items.map((item) => {
                const Icon = item.kind === 'TABLE' ? Table2 : FileText
                return (
                  <li key={item.id}>
                    <Link href={`/publications/${item.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-[#232323] focus-visible:outline focus-visible:outline-2">
                      <Icon size={18} className="shrink-0 text-[#a6a6a6]" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[14px] font-medium text-white">
                          {item.pinned && <Pin size={13} aria-label="Angeheftet" />}
                          {item.access === 'ROLES' && <Lock size={13} aria-label="Nur für freigegebene Rollen" />}
                          <span className="truncate">{item.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-[#909090]">
                          {item.status === 'PUBLISHED' ? (item.listed ? 'Auf dem Schwarzen Brett' : 'Nur per Link') : 'Nicht öffentlich'} · geändert {formatDate(item.updatedAt)}{item.createdBy ? ` · ${item.createdBy.displayName}` : ''}
                        </span>
                      </span>
                      <Badge variant={STATUS_VARIANT[item.status]}>{PUBLICATION_STATUS[item.status]}</Badge>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink, EyeOff, Info, User } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn, formatDateTime } from '@/lib/utils'
import {
  KUMMERKASTEN_STATUSES,
  KUMMERKASTEN_STATUS_LABELS,
  KUMMERKASTEN_STATUS_VARIANT,
  type KummerkastenStatusValue,
} from '@/lib/kummerkasten/kummerkasten'

interface Entry {
  id: number
  number: string
  subject: string
  message: string
  anonymous: boolean
  authorName: string | null
  authorDiscordId: string | null
  authorAvatarUrl: string | null
  status: KummerkastenStatusValue
  imageUrl: string | null
  threadUrl: string | null
  createdAt: string
  updatedAt: string
}

export default function KummerkastenEntryPage() {
  const params = useParams<{ id: string }>()
  const { user } = useAuth()
  const canView = hasPermission(user, 'kummerkasten:view')
  const canManage = hasPermission(user, 'kummerkasten:manage')
  const { data: entry, loading, setData } = useFetch<Entry>(canView ? `/api/kummerkasten/${params.id}` : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [saving, setSaving] = useState<KummerkastenStatusValue | null>(null)
  const [lightbox, setLightbox] = useState(false)

  if (!canView) return <UnauthorizedContent />
  if (loading && !entry) return <PageLoader withHeader />
  if (!entry) return <EmptyState icon={Info} title="Einsendung nicht gefunden" />

  const changeStatus = async (status: KummerkastenStatusValue) => {
    const previous = entry.status
    setSaving(status)
    setData((current) => (current ? { ...current, status } : current))
    try {
      await execute(`/api/kummerkasten/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      addToast({ type: 'success', title: `Status: ${KUMMERKASTEN_STATUS_LABELS[status]}` })
    } catch (err) {
      setData((current) => (current ? { ...current, status: previous } : current))
      addToast({ type: 'error', title: 'Status nicht geändert', message: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={entry.subject}
        eyebrow={entry.number}
        breadcrumbs={[{ label: 'Kummerkasten', href: '/kummerkasten' }, { label: entry.number }]}
        badge={<Badge variant={KUMMERKASTEN_STATUS_VARIANT[entry.status]}>{KUMMERKASTEN_STATUS_LABELS[entry.status]}</Badge>}
        action={entry.threadUrl ? (
          <a href={entry.threadUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm"><ExternalLink size={13} /> Forum-Beitrag</Button>
          </a>
        ) : undefined}
      />

      <section className="glass-panel-elevated mb-4 rounded-[14px] p-4" aria-label="Absender">
        {entry.anonymous ? (
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2c2c2e]"><EyeOff size={15} className="text-[#98989d]" aria-hidden /></span>
            <div>
              <p className="text-[13.5px] font-medium text-[#eee]">Anonym</p>
              <p className="text-[12px] text-[#8e8e93]">Absender unbekannt, Rückfragen sind nicht möglich.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            {entry.authorAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.authorAvatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2c2c2e]"><User size={15} className="text-[#98989d]" aria-hidden /></span>
            )}
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-[#eee]">{entry.authorName}</p>
              <p className="text-[12px] text-[#8e8e93]">
                Discord-ID <span className="font-mono">{entry.authorDiscordId}</span>
              </p>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-[#8e8e93]">Eingegangen {formatDateTime(entry.createdAt)}</p>
      </section>

      <section className="glass-panel-elevated mb-4 rounded-[14px] p-5" aria-label="Nachricht">
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[#d4d4d4]">{entry.message}</p>
        {entry.imageUrl && (
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="mt-4 block overflow-hidden rounded-[10px] border border-[#38383a]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/60"
            aria-label="Foto vergrößern"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.imageUrl} alt="Angehängtes Foto" className="max-h-[420px] w-auto" />
          </button>
        )}
      </section>

      {canManage && (
        <section className="glass-panel-elevated rounded-[14px] p-4" aria-label="Status">
          <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#98989d]">Status</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Status ändern">
            {KUMMERKASTEN_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={entry.status === status}
                disabled={saving !== null}
                onClick={() => entry.status !== status && changeStatus(status)}
                className={cn(
                  'rounded-[8px] px-3.5 py-[7px] text-[13px] font-medium transition-colors duration-100 disabled:opacity-60',
                  entry.status === status ? 'bg-[#d4d4d4] text-[#1c1c1e]' : 'text-[#98989d] hover:bg-[#2c2c2e] hover:text-[#eee]',
                )}
              >
                {KUMMERKASTEN_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] text-[#8e8e93]">Der Forum-Beitrag im FIB-Discord wird automatisch angepasst. Bei „Erledigt“ wird er archiviert.</p>
        </section>
      )}

      {lightbox && entry.imageUrl && (
        <ImageLightbox
          images={[{ id: String(entry.id), title: `${entry.number} · Foto`, url: entry.imageUrl }]}
          startId={String(entry.id)}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Archive, FileText, ImageIcon, Megaphone, Plus, Save, Send, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'
import {
  PRESS_RELEASE_STATUS_META,
  pressReleaseExcerpt,
  type PressReleaseStatusValue,
} from '@/lib/press-releases'

interface PressRelease {
  id: string
  title: string
  slug: string
  summary: string | null
  content: string
  imageUrl: string | null
  imageAlt: string | null
  status: PressReleaseStatusValue
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; displayName: string } | null
  updatedBy: { id: string; displayName: string } | null
}

interface PressForm {
  title: string
  summary: string
  content: string
  imageUrl: string
  imageAlt: string
  status: PressReleaseStatusValue
}

const EMPTY_FORM: PressForm = {
  title: '',
  summary: '',
  content: '',
  imageUrl: '',
  imageAlt: '',
  status: 'DRAFT',
}

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Entwurf' },
  { value: 'PUBLISHED', label: 'Veröffentlicht' },
  { value: 'ARCHIVED', label: 'Archiviert' },
]

function formFromRelease(release: PressRelease): PressForm {
  return {
    title: release.title,
    summary: release.summary ?? '',
    content: release.content,
    imageUrl: release.imageUrl ?? '',
    imageAlt: release.imageAlt ?? '',
    status: release.status,
  }
}

function StatusPill({ status }: { status: PressReleaseStatusValue }) {
  const meta = PRESS_RELEASE_STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center rounded-[6px] border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]', meta.tone)}>
      {meta.label}
    </span>
  )
}

export function PressSpeakerWorkspace() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'press:view')
  const canManage = hasPermission(user, 'press:manage')
  const { data: releases, loading, refetch } = useFetch<PressRelease[]>(canView ? '/api/press-releases?scope=manage' : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<PressForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  const rows = releases ?? []
  const selectedRelease = selectedId ? rows.find((release) => release.id === selectedId) ?? null : null
  const publishedCount = rows.filter((release) => release.status === 'PUBLISHED').length
  const draftCount = rows.filter((release) => release.status === 'DRAFT').length
  const archivedCount = rows.filter((release) => release.status === 'ARCHIVED').length
  const previewText = form.summary.trim() || pressReleaseExcerpt(form.content || 'Inhalt der Pressemitteilung erscheint hier.')
  const previewHtml = renderMarkdown(form.content.trim() || 'Inhalt der Pressemitteilung erscheint hier.')

  const openNew = () => {
    setSelectedId(null)
    setForm(EMPTY_FORM)
  }

  const openRelease = (release: PressRelease) => {
    setSelectedId(release.id)
    setForm(formFromRelease(release))
  }

  const saveRelease = async (statusOverride?: PressReleaseStatusValue) => {
    if (!canManage || saving) return
    const payload = { ...form, status: statusOverride ?? form.status }
    setSaving(true)
    try {
      const result = await execute(selectedRelease ? `/api/press-releases/${selectedRelease.id}` : '/api/press-releases', {
        method: selectedRelease ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      }) as PressRelease | null
      if (result) {
        setSelectedId(result.id)
        setForm(formFromRelease(result))
      }
      addToast({ type: 'success', title: statusOverride === 'PUBLISHED' ? 'Pressemitteilung veröffentlicht' : 'Pressemitteilung gespeichert' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const deleteRelease = async () => {
    if (!selectedRelease || !canManage) return
    if (!confirm(`Pressemitteilung "${selectedRelease.title}" wirklich löschen?`)) return
    setSaving(true)
    try {
      await execute(`/api/press-releases/${selectedRelease.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Pressemitteilung gelöscht' })
      openNew()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const uploadImage = async (file: File | undefined) => {
    if (!file || !canManage) return
    setUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch('/api/press-releases/uploads', {
        method: 'POST',
        body,
        credentials: 'include',
      })
      const json = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: { url: string; originalName: string } } | null
      if (!res.ok || !json?.success || !json.data) {
        throw new Error(json?.error || 'Bild konnte nicht hochgeladen werden')
      }
      setForm((current) => ({
        ...current,
        imageUrl: json.data!.url,
        imageAlt: current.imageAlt || json.data!.originalName,
      }))
      addToast({ type: 'success', title: 'Bild hochgeladen' })
    } catch (err) {
      addToast({ type: 'error', title: 'Upload fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Pressesprecherbereich"
        description="Pressemitteilungen schreiben, bebildern und veröffentlichen."
        action={canManage ? (
          <Button size="sm" onClick={openNew}>
            <Plus size={14} strokeWidth={2} />
            Neuer Entwurf
          </Button>
        ) : undefined}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PressStat label="Veröffentlicht" value={publishedCount} tone="text-[#34d399]" />
        <PressStat label="Entwürfe" value={draftCount} tone="text-[#fbbf24]" />
        <PressStat label="Archiviert" value={archivedCount} tone="text-[#a6a6a6]" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <section className="glass-panel-elevated overflow-hidden rounded-[14px] border border-[#373737]/45">
          <div className="flex items-center justify-between border-b border-[#343434]/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <Megaphone size={15} className="text-[#d4d4d4]" />
              <h2 className="text-[13px] font-semibold text-white">Presse-Blöcke</h2>
            </div>
            <span className="text-[11.5px] text-[#909090]">{rows.length} Einträge</span>
          </div>

          {rows.length > 0 ? (
            <div className="max-h-[680px] divide-y divide-[#343434]/60 overflow-y-auto">
              {rows.map((release) => (
                <button
                  key={release.id}
                  type="button"
                  onClick={() => openRelease(release)}
                  className={cn(
                    'block w-full px-4 py-3 text-left transition-colors hover:bg-[#232323]/55',
                    selectedRelease?.id === release.id && 'bg-[#232323]/80',
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-white">{release.title}</p>
                    <StatusPill status={release.status} />
                  </div>
                  <p className="line-clamp-2 text-[12px] leading-5 text-[#a6a6a6]">
                    {release.summary || pressReleaseExcerpt(release.content)}
                  </p>
                  <p className="mt-2 text-[10.5px] text-[#686868]">
                    {formatDateTime(release.publishedAt ?? release.updatedAt)} · {release.updatedBy?.displayName ?? release.createdBy?.displayName ?? 'System'}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-16 text-center">
              <FileText size={28} className="mx-auto mb-3 text-[#808080]" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-white">Keine Pressemitteilungen</p>
              <p className="mt-1 text-[12px] text-[#909090]">Erstelle den ersten Entwurf.</p>
            </div>
          )}
        </section>

        <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-3 border-b border-[#343434]/55 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-white">
                {selectedRelease ? 'Pressemitteilung bearbeiten' : 'Neuen Entwurf schreiben'}
              </h2>
              <p className="mt-1 text-[12px] text-[#909090]">
                {selectedRelease ? `Slug: /${selectedRelease.slug}` : 'Der Eintrag bleibt intern, bis er veröffentlicht wird.'}
              </p>
            </div>
            {selectedRelease && <StatusPill status={selectedRelease.status} />}
          </div>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <Input
                label="Titel"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Titel der Pressemitteilung"
                disabled={!canManage}
              />
              <Textarea
                label="Kurztext"
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                rows={3}
                placeholder="Kurze Zusammenfassung für das Besucherportal"
                disabled={!canManage}
              />
              <Textarea
                label="Inhalt"
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                rows={12}
                placeholder="Pressemitteilung schreiben..."
                disabled={!canManage}
              />
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px]">
                <Input
                  label="Bild-URL"
                  value={form.imageUrl}
                  onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
                  placeholder="/uploads/..."
                  disabled={!canManage}
                />
                <div className="space-y-1.5">
                  <span className="block text-[12.5px] font-medium text-[#aeaeae]">Bild hochladen</span>
                  <label className={cn(
                    'flex h-[36px] cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[#404040] bg-[#232323] px-3 text-[12.5px] font-medium text-[#f4f4f4] transition-colors hover:bg-[#333333]',
                    (!canManage || uploading) && 'pointer-events-none opacity-40',
                  )}>
                    <Upload size={14} />
                    {uploading ? 'Lädt...' : 'Datei wählen'}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={!canManage || uploading}
                      onChange={(event) => {
                        void uploadImage(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>
              <Input
                label="Bildbeschreibung"
                value={form.imageAlt}
                onChange={(event) => setForm({ ...form, imageAlt: event.target.value })}
                placeholder="Optional"
                disabled={!canManage}
              />
              <Select
                label="Status"
                value={form.status}
                onValueChange={(value) => setForm({ ...form, status: value as PressReleaseStatusValue })}
                options={STATUS_OPTIONS}
                disabled={!canManage}
              />
            </div>

            <aside className="space-y-3">
              <div className="overflow-hidden rounded-[13px] border border-[#373737]/60 bg-[#181818]/65">
                <div
                  className="aspect-video bg-[#232323] bg-cover bg-center"
                  style={form.imageUrl ? { backgroundImage: `url(${form.imageUrl})` } : undefined}
                >
                  {!form.imageUrl && (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-[#909090]">
                      <ImageIcon size={28} strokeWidth={1.5} />
                      <span className="text-[12px]">Bildvorschau 16:9</span>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <StatusPill status={form.status} />
                  <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-5 text-white">
                    {form.title.trim() || 'Titel der Pressemitteilung'}
                  </h3>
                  <p className="mt-2 line-clamp-4 text-[12.5px] leading-5 text-[#aeaeae]">{previewText}</p>
                </div>
              </div>
              <div className="rounded-[12px] border border-[#343434]/55 bg-[#181818]/55 p-3">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#909090]">Markdown-Vorschau</p>
                <div
                  className="markdown-document text-[13px] leading-6 text-[#e5e5e5]"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
              <div className="rounded-[12px] border border-[#343434]/55 bg-[#181818]/55 p-3 text-[12px] leading-5 text-[#a6a6a6]">
                Sichtbar im Besucherportal ist nur der Status „Veröffentlicht“. Entwürfe und archivierte Meldungen bleiben intern.
              </div>
            </aside>
          </div>

          {canManage && (
            <div className="mt-5 flex flex-col gap-2 border-t border-[#343434]/55 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void saveRelease()} loading={saving} disabled={!form.title.trim() || !form.content.trim()}>
                  <Save size={13} />
                  Speichern
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void saveRelease('PUBLISHED')} loading={saving} disabled={!form.title.trim() || !form.content.trim()}>
                  <Send size={13} />
                  Veröffentlichen
                </Button>
                {selectedRelease?.status === 'PUBLISHED' && (
                  <Button size="sm" variant="secondary" onClick={() => void saveRelease('ARCHIVED')} loading={saving}>
                    <Archive size={13} />
                    Archivieren
                  </Button>
                )}
              </div>
              {selectedRelease && (
                <Button size="sm" variant="danger" onClick={deleteRelease} loading={saving}>
                  <Trash2 size={13} />
                  Löschen
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function PressStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="glass-panel-elevated rounded-[12px] border border-[#373737]/45 p-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#a6a6a6]">{label}</p>
      <p className={cn('mt-1 text-[22px] font-bold tabular-nums', tone)}>{value}</p>
    </div>
  )
}

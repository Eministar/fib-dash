'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ExternalLink,
  FileArchive,
  FileText,
  FolderOpen,
  ImageIcon,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { uploadInChunks } from '@/lib/chunked-upload'

type ResourceScope = 'GENERAL' | 'TRAINING'
type ResourceType = 'FILE' | 'LINK'

interface TrainingOption {
  id: string
  label: string
  sortOrder: number
}

interface AcademyResource {
  id: string
  scope: ResourceScope
  type: ResourceType
  title: string
  description: string | null
  trainingId: string | null
  training: TrainingOption | null
  customTrainingName: string | null
  url: string | null
  originalFilename: string | null
  mimeType: string | null
  size: number | null
  createdAt: string
  createdBy: { id: string; displayName: string } | null
}

interface ResourcesPayload {
  resources: AcademyResource[]
  trainings: TrainingOption[]
}

interface AcademyResourcesProps {
  mode: 'files' | 'training'
  canManage: boolean
}

interface ResourceForm {
  title: string
  description: string
  type: ResourceType
  trainingChoice: string
  customTrainingName: string
  url: string
}

const EMPTY_FORM: ResourceForm = {
  title: '',
  description: '',
  type: 'FILE',
  trainingChoice: '',
  customTrainingName: '',
  url: '',
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

function resourceIcon(resource: AcademyResource) {
  if (resource.type === 'LINK') return Link2
  const extension = resource.originalFilename?.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return ImageIcon
  if (['zip', 'rar', '7z'].includes(extension)) return FileArchive
  return FileText
}

export function AcademyResources({ mode, canManage }: AcademyResourcesProps) {
  const { data, loading, refetch } = useFetch<ResourcesPayload>('/api/academy/resources')
  const { execute } = useApi()
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<ResourceForm>(EMPTY_FORM)

  const scope: ResourceScope = mode === 'files' ? 'GENERAL' : 'TRAINING'
  const resources = useMemo(
    () => (data?.resources ?? []).filter((resource) => resource.scope === scope),
    [data, scope],
  )
  const groupedResources = useMemo(() => {
    const groups = new Map<string, { label: string; sortOrder: number; resources: AcademyResource[] }>()
    for (const resource of resources) {
      const key = resource.trainingId
        ? `training:${resource.trainingId}`
        : `custom:${resource.customTrainingName ?? 'Eigene Ressourcen'}`
      const label = resource.training?.label ?? resource.customTrainingName ?? 'Eigene Ressourcen'
      const sortOrder = resource.training?.sortOrder ?? Number.MAX_SAFE_INTEGER
      const group = groups.get(key) ?? { label, sortOrder, resources: [] }
      group.resources.push(resource)
      groups.set(key, group)
    }
    return Array.from(groups.values()).sort((a, b) => (
      a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'de')
    ))
  }, [resources])

  const resetForm = () => {
    setCreating(false)
    setSubmitting(false)
    setFile(null)
    setForm(EMPTY_FORM)
    if (fileRef.current) fileRef.current.value = ''
  }

  const createResource = async () => {
    const effectiveType: ResourceType = mode === 'files' ? 'FILE' : form.type
    if (!form.title.trim()) return
    if (effectiveType === 'FILE' && !file) return
    if (mode === 'training' && !form.trainingChoice) return
    if (form.trainingChoice === '__custom__' && !form.customTrainingName.trim()) return

    setSubmitting(true)
    try {
      // Erst die Datei in Stuecken uebertragen, dann die Ressource anlegen.
      // Bei einem Link entfaellt der Upload-Schritt ganz.
      const uploadId = effectiveType === 'FILE' && file ? (await uploadInChunks(file, 'RESOURCE')).uploadId : null

      const body: Record<string, string | null> = {
        scope,
        type: effectiveType,
        title: form.title.trim(),
        description: form.description.trim(),
      }
      if (mode === 'training') {
        if (form.trainingChoice === '__custom__') body.customTrainingName = form.customTrainingName.trim()
        else body.trainingId = form.trainingChoice
      }
      if (effectiveType === 'LINK') body.url = form.url.trim()
      if (uploadId) body.uploadId = uploadId

      const response = await fetch('/api/academy/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
        cache: 'no-store',
      })
      const json = await response.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!response.ok || !json?.success) throw new Error(json?.error || 'Ressource konnte nicht erstellt werden')
      addToast({ type: 'success', title: mode === 'files' ? 'Datei hochgeladen' : 'Ressource erstellt' })
      resetForm()
      await refetch()
    } catch (error) {
      setSubmitting(false)
      addToast({
        type: 'error',
        title: 'Speichern fehlgeschlagen',
        message: error instanceof Error ? error.message : '',
      })
    }
  }

  const deleteResource = async (resource: AcademyResource) => {
    if (!confirm(`„${resource.title}“ dauerhaft löschen?`)) return
    try {
      await execute(`/api/academy/resources/${resource.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Ressource gelöscht' })
      await refetch()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Löschen fehlgeschlagen',
        message: error instanceof Error ? error.message : '',
      })
    }
  }

  if (loading) return <PageLoader />

  const title = mode === 'files' ? 'Academy Dateien' : 'Ausbildungsressourcen'
  const description = mode === 'files'
    ? 'Zentrale Dateiablage für Academy-Unterlagen'
    : 'Dateien, Links und Tests geordnet nach Ausbildung'

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={refetch}>
              <RefreshCw size={13} />
              Aktualisieren
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setCreating(true)}>
                {mode === 'files' ? <Upload size={13} /> : <Plus size={13} />}
                {mode === 'files' ? 'Datei hochladen' : 'Ressource erstellen'}
              </Button>
            )}
          </div>
        }
      />

      {creating && (
        <section className="rounded-[14px] border border-[#404040]/75 bg-[#181818] p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[#f4f4f4]">
                {mode === 'files' ? 'Neue Datei' : 'Neue Ausbildungsressource'}
              </h2>
              <p className="mt-1 text-[12px] text-[#909090]">
                {mode === 'files'
                  ? 'Die Datei wird in der allgemeinen Academy-Ablage gespeichert.'
                  : 'Ordne die Ressource einer Ausbildung oder einer eigenen Kategorie zu.'}
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#909090] hover:bg-[#232323] hover:text-[#f4f4f4]"
              aria-label="Formular schließen"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Input
              label="Titel"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder={mode === 'files' ? 'z. B. Academy-Handbuch' : 'z. B. Abschlusstest'}
              required
            />

            {mode === 'training' && (
              <Select
                label="Ausbildung"
                value={form.trainingChoice}
                onValueChange={(trainingChoice) => setForm({ ...form, trainingChoice })}
                options={[
                  { value: '', label: 'Ausbildung auswählen' },
                  ...(data?.trainings ?? []).map((training) => ({
                    value: training.id,
                    label: training.label,
                  })),
                  { value: '__custom__', label: 'Eigene Ausbildung / Kategorie' },
                ]}
              />
            )}

            {mode === 'training' && form.trainingChoice === '__custom__' && (
              <Input
                label="Eigene Bezeichnung"
                value={form.customTrainingName}
                onChange={(event) => setForm({ ...form, customTrainingName: event.target.value })}
                placeholder="z. B. Field Training"
                required
              />
            )}

            {mode === 'training' && (
              <Select
                label="Ressourcentyp"
                value={form.type}
                onValueChange={(type) => setForm({ ...form, type: type as ResourceType })}
                options={[
                  { value: 'FILE', label: 'Datei hochladen' },
                  { value: 'LINK', label: 'Link oder Online-Test' },
                ]}
              />
            )}

            {(mode === 'files' || form.type === 'FILE') ? (
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[#aeaeae]">Datei</label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    'flex h-[42px] w-full items-center gap-2 rounded-[8px] border px-3 text-left text-[12.5px] transition-colors',
                    file
                      ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/8 text-[#f4f4f4]'
                      : 'border-[#343434] bg-[#080808] text-[#909090] hover:border-[#404040]',
                  )}
                >
                  <Upload size={14} className={file ? 'text-[#d4d4d4]' : ''} />
                  <span className="truncate">{file?.name ?? 'Datei auswählen'}</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null
                    setFile(nextFile)
                    if (nextFile && !form.title.trim()) {
                      setForm((current) => ({ ...current, title: nextFile.name.replace(/\.[^.]+$/, '') }))
                    }
                  }}
                />
              </div>
            ) : (
              <Input
                label="Link"
                type="url"
                value={form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                placeholder="https://..."
                required
              />
            )}

            <div className="lg:col-span-2">
              <Textarea
                label="Beschreibung (optional)"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={3}
                placeholder="Worum geht es und wann wird die Ressource benötigt?"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetForm}>Abbrechen</Button>
            <Button
              size="sm"
              loading={submitting}
              onClick={createResource}
              disabled={
                !form.title.trim() ||
                ((mode === 'files' || form.type === 'FILE') && !file) ||
                (mode === 'training' && !form.trainingChoice) ||
                (form.trainingChoice === '__custom__' && !form.customTrainingName.trim()) ||
                (mode === 'training' && form.type === 'LINK' && !form.url.trim())
              }
            >
              Speichern
            </Button>
          </div>
        </section>
      )}

      {mode === 'files' ? (
        <ResourceList resources={resources} canManage={canManage} onDelete={deleteResource} />
      ) : (
        <div className="space-y-4">
          {groupedResources.map((group) => (
            <section key={group.label} className="overflow-hidden rounded-[14px] border border-[#343434]/70 bg-[#161616]">
              <div className="flex items-center gap-3 border-b border-[#343434]/60 px-4 py-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#d4d4d4]/12 text-[#d4d4d4]">
                  <FolderOpen size={15} />
                </span>
                <div>
                  <h2 className="text-[13.5px] font-semibold text-[#f4f4f4]">{group.label}</h2>
                  <p className="text-[11px] text-[#909090]">{group.resources.length} Ressource(n)</p>
                </div>
              </div>
              <ResourceList resources={group.resources} canManage={canManage} onDelete={deleteResource} nested />
            </section>
          ))}
        </div>
      )}

      {resources.length === 0 && !creating && (
        <div className="rounded-[14px] border border-dashed border-[#404040]/70 px-5 py-16 text-center">
          {mode === 'files'
            ? <Upload size={27} className="mx-auto mb-3 text-[#808080]" />
            : <FolderOpen size={27} className="mx-auto mb-3 text-[#808080]" />}
          <p className="text-[13px] font-medium text-[#aeaeae]">
            {mode === 'files' ? 'Noch keine Academy-Dateien' : 'Noch keine Ausbildungsressourcen'}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-2 text-[12px] font-medium text-[#d4d4d4] hover:text-[#cacaca]"
            >
              Jetzt {mode === 'files' ? 'eine Datei hochladen' : 'eine Ressource erstellen'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ResourceList({
  resources,
  canManage,
  onDelete,
  nested = false,
}: {
  resources: AcademyResource[]
  canManage: boolean
  onDelete: (resource: AcademyResource) => void
  nested?: boolean
}) {
  if (resources.length === 0) return null

  return (
    <div className={cn('divide-y divide-[#343434]/60', !nested && 'overflow-hidden rounded-[14px] border border-[#343434]/70 bg-[#161616]')}>
      {resources.map((resource) => {
        const Icon = resourceIcon(resource)
        return (
          <div key={resource.id} className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#1e1e1e]">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#404040]/60 bg-[#080808] text-[#d4d4d4]">
              <Icon size={16} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[13.5px] font-semibold text-[#f4f4f4]">{resource.title}</p>
                <span className="rounded-full border border-[#404040]/60 px-2 py-0.5 text-[10px] font-medium text-[#a6a6a6]">
                  {resource.type === 'LINK' ? 'Link' : 'Datei'}
                </span>
              </div>
              {resource.description && (
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[#a6a6a6]">{resource.description}</p>
              )}
              <p className="mt-1.5 text-[10.5px] text-[#686868]">
                {resource.originalFilename && `${resource.originalFilename} · `}
                {resource.size !== null && `${formatBytes(resource.size)} · `}
                {formatDateTime(resource.createdAt)}
                {resource.createdBy ? ` · ${resource.createdBy.displayName}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {resource.url && (
                <Link
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[11.5px] font-medium text-[#aeaeae] hover:bg-[#232323] hover:text-[#d4d4d4]"
                >
                  <ExternalLink size={13} />
                  Öffnen
                </Link>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => onDelete(resource)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#909090] hover:bg-[#2a1212] hover:text-[#fca5a5]"
                  aria-label={`${resource.title} löschen`}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

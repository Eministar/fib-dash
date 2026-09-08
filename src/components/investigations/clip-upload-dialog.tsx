'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { FileVideo, UploadCloud, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type { AgentLite, BodycamClip, InvestigationEntry } from '@/components/investigations/types'

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']
const ACCEPT_ATTRIBUTE = '.mp4,.webm,.mov,.mkv,video/mp4,video/webm,video/quicktime,video/x-matroska'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Der Header muss reines ASCII enthalten, die Metadaten dagegen Umlaute
 * transportieren – deshalb UTF-8 kodieren und dann base64.
 */
function encodeMeta(meta: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(meta))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Liest die Laufzeit aus der Datei, damit sie nicht von Hand gepflegt werden muss. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    const finish = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
    video.onerror = () => finish(null)
    video.src = url
  })
}

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

interface ClipUploadDialogProps {
  open: boolean
  onClose: () => void
  investigationId: string
  entries: InvestigationEntry[]
  agents: AgentLite[]
  onUploaded: (clip: BodycamClip) => void
}

export function ClipUploadDialog({
  open,
  onClose,
  investigationId,
  entries,
  agents,
  onUploaded,
}: ClipUploadDialogProps) {
  const { toastSuccess, toastError } = useInvestigationToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<XMLHttpRequest | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [recordedAt, setRecordedAt] = useState(localDateTimeValue())
  const [entryId, setEntryId] = useState('')
  const [recordedByAgentId, setRecordedByAgentId] = useState('')
  const [tags, setTags] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const entryOptions = useMemo(
    () => [
      { value: '', label: 'Kein Eintrag (direkt an der Akte)' },
      ...entries.map((entry) => ({ value: entry.id, label: entry.title })),
    ],
    [entries],
  )

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'Nicht zugeordnet' },
      ...agents.map((agent) => ({
        value: agent.id,
        label: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
      })),
    ],
    [agents],
  )

  const reset = useCallback(() => {
    setFile(null)
    setTitle('')
    setDescription('')
    setLocation('')
    setRecordedAt(localDateTimeValue())
    setEntryId('')
    setRecordedByAgentId('')
    setTags('')
    setProgress(null)
    setDragging(false)
  }, [])

  const handleClose = () => {
    if (progress !== null) {
      requestRef.current?.abort()
      requestRef.current = null
    }
    reset()
    onClose()
  }

  const acceptFile = (candidate: File | null | undefined) => {
    if (!candidate) return
    if (candidate.type && !ACCEPTED_TYPES.includes(candidate.type)) {
      toastError('Format nicht unterstützt', 'Erlaubt sind MP4, WebM, MOV und MKV.')
      return
    }
    setFile(candidate)
    // Der Dateiname ist fast immer die brauchbarste Vorbelegung für den Titel.
    if (!title.trim()) setTitle(candidate.name.replace(/\.[^.]+$/, ''))
  }

  const handleUpload = async () => {
    if (!file) {
      toastError('Keine Datei', 'Bitte zuerst einen Clip auswählen.')
      return
    }
    if (!title.trim()) {
      toastError('Titel fehlt', 'Bitte einen Titel für den Clip angeben.')
      return
    }

    const durationSeconds = await readDuration(file)

    const meta = encodeMeta({
      investigationId,
      entryId: entryId || null,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      recordedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
      recordedByAgentId: recordedByAgentId || null,
      originalName: file.name,
      durationSeconds,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })

    setProgress(0)

    try {
      const clip = await new Promise<BodycamClip>((resolve, reject) => {
        const request = new XMLHttpRequest()
        requestRef.current = request
        request.open('POST', '/api/investigations/clips')
        request.withCredentials = true
        request.setRequestHeader('Content-Type', file.type || 'video/mp4')
        request.setRequestHeader('x-clip-meta', meta)
        request.setRequestHeader('x-upload-size', String(file.size))

        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100))
        }

        request.onload = () => {
          if (request.status === 413 || request.status === 404 && request.responseText.includes('404.13')) {
            reject(new Error('Der vorgeschaltete Webserver lehnt die Dateigröße ab. Upload-Limit auf dem Server prüfen (HTTP ' + request.status + ').'))
            return
          }
          try {
            const parsed = JSON.parse(request.responseText) as {
              success?: boolean
              error?: string
              data?: BodycamClip
            }
            if (request.status >= 200 && request.status < 300 && parsed.success && parsed.data) {
              resolve(parsed.data)
            } else {
              reject(new Error(parsed.error || `Upload fehlgeschlagen (HTTP ${request.status})`))
            }
          } catch {
            reject(new Error(`Upload fehlgeschlagen (HTTP ${request.status})`))
          }
        }
        request.onerror = () => reject(new Error('Verbindung zum Server unterbrochen'))
        request.onabort = () => reject(new Error('Upload abgebrochen'))

        request.send(file)
      })

      toastSuccess('Clip hochgeladen', `"${clip.title}" wurde der Akte hinzugefügt.`)
      onUploaded(clip)
      reset()
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unbekannter Fehler'
      if (message !== 'Upload abgebrochen') toastError('Upload fehlgeschlagen', message)
      setProgress(null)
    } finally {
      requestRef.current = null
    }
  }

  const uploading = progress !== null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bodycam-Clip hochladen"
      description="Clips werden nach dem Upload automatisch platzsparend komprimiert. Die Aufnahme bleibt währenddessen verfügbar."
      size="xl"
    >
      <div className="space-y-4">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            acceptFile(event.dataTransfer.files?.[0])
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-8 text-center transition-colors',
            dragging ? 'border-[#a78bfa] bg-[#a78bfa]/5' : 'border-[#343434] bg-[#141414] hover:border-[#4a4a4a]',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          {file ? (
            <>
              <FileVideo className="h-6 w-6 text-[#a78bfa]" />
              <p className="text-[13px] font-medium text-white">{file.name}</p>
              <p className="text-[12px] text-[#808080]">{formatBytes(file.size)}</p>
              {!uploading && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setFile(null)
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[#a6a6a6] hover:text-white"
                >
                  <X className="h-3 w-3" />
                  Andere Datei wählen
                </button>
              )}
            </>
          ) : (
            <>
              <UploadCloud className="h-6 w-6 text-[#6a6a6a]" />
              <p className="text-[13px] text-[#d4d4d4]">Clip hierher ziehen oder klicken</p>
              <p className="text-[11.5px] text-[#6a6a6a]">MP4, WebM, MOV oder MKV</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            onChange={(event) => acceptFile(event.target.files?.[0])}
          />
        </div>

        {uploading && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#232323]">
              <div
                className="h-full rounded-full bg-[#a78bfa] transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-[#808080]">
              {progress}% übertragen{progress === 100 ? ' – wird gespeichert…' : ''}
            </p>
          </div>
        )}

        <Input
          label="Titel"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="z. B. Zugriff Tankstelle Grapeseed"
          disabled={uploading}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Aufnahmezeitpunkt"
            type="datetime-local"
            value={recordedAt}
            onChange={(event) => setRecordedAt(event.target.value)}
            disabled={uploading}
          />
          <Input
            label="Ort"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="z. B. Route 68"
            disabled={uploading}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Bodycam von"
            options={agentOptions}
            value={recordedByAgentId}
            onValueChange={setRecordedByAgentId}
            disabled={uploading}
          />
          <Select
            label="Zu Eintrag"
            options={entryOptions}
            value={entryId}
            onValueChange={setEntryId}
            disabled={uploading}
          />
        </div>

        <Input
          label="Schlagworte (Komma-getrennt)"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="Zugriff, Schusswaffengebrauch"
          disabled={uploading}
        />

        <Textarea
          label="Beschreibung"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Was ist auf der Aufnahme zu sehen?"
          rows={3}
          disabled={uploading}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={handleClose}>
            {uploading ? 'Abbrechen' : 'Schließen'}
          </Button>
          <Button onClick={handleUpload} loading={uploading} disabled={!file}>
            Hochladen
          </Button>
        </div>
      </div>
    </Modal>
  )
}

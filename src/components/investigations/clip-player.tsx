'use client'

import Link from 'next/link'
import { Clock3, MapPin, Trash2, User } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { formatDateTime } from '@/lib/utils'
import type { BodycamClip } from '@/components/investigations/types'

export function formatClipSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatClipDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return null
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function clipStreamUrl(clipId: string) {
  return `/api/investigations/clips/${clipId}/stream`
}

interface ClipPlayerProps {
  clip: BodycamClip | null
  onClose: () => void
  onDelete?: (clip: BodycamClip) => void
  /** Blendet einen Link zur zugehörigen Akte ein (für den Katalog). */
  showCaseLink?: boolean
}

export function ClipPlayer({ clip, onClose, onDelete, showCaseLink = false }: ClipPlayerProps) {
  if (!clip) return null

  const duration = formatClipDuration(clip.durationSeconds)

  return (
    <Modal open={Boolean(clip)} onClose={onClose} title={clip.title} size="xl">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-black">
          {/* `key` erzwingt ein frisches Element pro Clip – sonst behält der
              Player die Quelle des zuvor geöffneten Clips. */}
          <video
            key={`${clip.id}-${clip.filename}`}
            controls
            preload="metadata"
            className="max-h-[60vh] w-full"
            src={`${clipStreamUrl(clip.id)}?v=${encodeURIComponent(clip.filename)}`}
          >
            Dein Browser kann dieses Video nicht abspielen.
          </video>
        </div>

        {clip.description && (
          <p className="text-[13px] leading-relaxed text-[#c4c4c4]">{clip.description}</p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-[#808080]">
          {clip.recordedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {formatDateTime(clip.recordedAt)}
            </span>
          )}
          {clip.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {clip.location}
            </span>
          )}
          {clip.recordedByAgent && (
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              {clip.recordedByAgent.firstName} {clip.recordedByAgent.lastName} (
              {clip.recordedByAgent.badgeNumber})
            </span>
          )}
          <span>{formatClipSize(clip.sizeBytes)}</span>
          {clip.originalSizeBytes != null && clip.originalSizeBytes > clip.sizeBytes && <span>{Math.round((1 - clip.sizeBytes / clip.originalSizeBytes) * 100)} % Speicher gespart</span>}
          {['PENDING', 'PROCESSING'].includes(clip.compressionStatus ?? '') && <span>Komprimierung läuft im Hintergrund</span>}
          {clip.compressionStatus === 'FAILED' && <span>Komprimierung fehlgeschlagen · Original verfügbar</span>}
          {duration && <span>{duration} Min.</span>}
        </div>

        {clip.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {clip.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#232323] pt-3">
          <div className="text-[11.5px] text-[#6a6a6a]">
            {showCaseLink && clip.investigation && (
              <Link
                href={`/investigations/${clip.investigation.id}`}
                className="text-[#c4b5fd] hover:underline"
              >
                {clip.investigation.caseNumber} – {clip.investigation.title}
              </Link>
            )}
            {clip.uploadedBy && <span className="ml-2">Hochgeladen von {clip.uploadedBy.displayName}</span>}
          </div>

          {onDelete && (
            <Button variant="danger" size="sm" onClick={() => onDelete(clip)}>
              <Trash2 className="h-3.5 w-3.5" />
              Clip löschen
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

interface ClipCardProps {
  clip: BodycamClip
  onOpen: (clip: BodycamClip) => void
  showCase?: boolean
}

export function ClipCard({ clip, onOpen, showCase = false }: ClipCardProps) {
  const duration = formatClipDuration(clip.durationSeconds)

  return (
    <button
      type="button"
      onClick={() => onOpen(clip)}
      className="group flex w-full flex-col overflow-hidden rounded-[12px] border border-[#2a2a2a] bg-[#141414] text-left transition-colors hover:border-[#404040] hover:bg-[#181818]"
    >
      <div className="relative aspect-video w-full bg-black">
        {/* Kein eigenes Vorschaubild: der Browser zieht sich das erste Frame
            selbst über eine Range-Anfrage an die Streaming-Route. */}
        <video
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
          src={`${clipStreamUrl(clip.id)}?v=${encodeURIComponent(clip.filename)}#t=0.5`}
        />
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded-[5px] bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {duration}
          </span>
        )}
      </div>

      <div className="min-w-0 p-3">
        <p className="truncate text-[13.5px] font-medium text-white group-hover:text-white">{clip.title}</p>
        {showCase && clip.investigation && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-[#d4af37]">
            {clip.investigation.caseNumber}
          </p>
        )}
        <p className="mt-1 truncate text-[11.5px] text-[#6a6a6a]">
          {clip.recordedAt ? formatDateTime(clip.recordedAt) : formatDateTime(clip.createdAt)}
          {clip.recordedByAgent
            ? ` · ${clip.recordedByAgent.firstName} ${clip.recordedByAgent.lastName}`
            : ''}
        </p>
      </div>
    </button>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'

import { cn } from '@/lib/utils'

export type LightboxImage = { id: string; title: string; url: string }

/**
 * Vollbild-Betrachter für die Bilder einer Akte. Blättert mit Pfeiltasten
 * und Knöpfen durch die Sammlung, schließt mit Esc. Bewusst kein `Modal`:
 * der Betrachter soll randlos sein und die Tastatur allein bedienen.
 */
export function ImageLightbox({
  images,
  startId,
  onClose,
}: {
  images: LightboxImage[]
  startId: string | null
  onClose: () => void
}) {
  const open = startId !== null
  const [index, setIndex] = useState(0)

  // Beim Öffnen auf das angeklickte Bild springen.
  useEffect(() => {
    if (!open) return
    const position = images.findIndex((image) => image.id === startId)
    setIndex(position >= 0 ? position : 0)
  }, [open, startId, images])

  const step = useCallback(
    (delta: number) => {
      if (images.length === 0) return
      setIndex((current) => (current + delta + images.length) % images.length)
    },
    [images.length],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    // Der Hintergrund darf nicht mitscrollen, solange das Bild offen ist.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose, step])

  if (!open || images.length === 0) return null
  const current = images[Math.min(index, images.length - 1)]
  if (!current) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
      className="fixed inset-0 z-[60] flex flex-col bg-[#080808]/95 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12.5px] text-[#c4c4c4]">
        <span className="min-w-0 truncate">{current.title}</span>
        <div className="flex shrink-0 items-center gap-3">
          {images.length > 1 && (
            <span className="font-mono text-[11.5px] text-[#808080]">
              {index + 1} / {images.length}
            </span>
          )}
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="rounded-md p-1.5 text-[#a6a6a6] hover:bg-[#232323] hover:text-white"
            aria-label="In neuem Tab öffnen"
            title="In voller Auflösung öffnen"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[#a6a6a6] hover:bg-[#232323] hover:text-white"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
        {images.length > 1 && (
          <LightboxArrow side="left" onClick={() => step(-1)} />
        )}

        {/* Klick auf das Bild selbst schließt nicht – sonst trifft man beim
            Blättern ständig daneben und der Betrachter klappt zu. */}
        <Image
          unoptimized
          src={current.url}
          alt={current.title}
          width={2000}
          height={1400}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full w-auto max-w-full object-contain"
        />

        {images.length > 1 && <LightboxArrow side="right" onClick={() => step(1)} />}
      </div>

      {images.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4" onClick={(event) => event.stopPropagation()}>
          {images.map((image, position) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setIndex(position)}
              aria-label={image.title}
              aria-current={position === index}
              className={cn(
                'h-12 w-16 shrink-0 overflow-hidden rounded border',
                position === index ? 'border-[#a78bfa]' : 'border-[#343434] opacity-60 hover:opacity-100',
              )}
            >
              <Image unoptimized src={image.url} alt="" width={128} height={96} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LightboxArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={side === 'left' ? 'Vorheriges Bild' : 'Nächstes Bild'}
      className={cn(
        'absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full',
        'border border-[#343434] bg-[#181818]/80 text-[#c4c4c4] hover:border-[#a78bfa] hover:text-white',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

/** Klickbares Vorschaubild, das den Betrachter öffnet. */
export function LightboxThumb({
  image,
  onOpen,
  className,
}: {
  image: LightboxImage
  onOpen: (id: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(image.id)}
      title={image.title}
      className={cn(
        'group relative overflow-hidden rounded-lg border border-[#2a2a2a] transition-colors hover:border-[#a78bfa]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/40',
        className,
      )}
    >
      <Image
        unoptimized
        src={image.url}
        alt={image.title}
        width={320}
        height={240}
        className="aspect-[4/3] w-full object-cover"
      />
      <span className="absolute inset-x-0 bottom-0 truncate bg-[#080808]/75 px-2 py-1 text-left text-[11px] text-[#d4d4d4] opacity-0 transition-opacity group-hover:opacity-100">
        {image.title}
      </span>
    </button>
  )
}

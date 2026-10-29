'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { cropStyle, DEFAULT_CROP, dragCrop, type PhotoCrop } from '@/lib/investigations/person-profile'
import { PhotoField, type CatalogPhoto } from './photo-catalog'
import { Button } from '@/components/ui/button'

export function PersonPortrait({ src, name, crop, size = 64 }: { src: string | null; name: string; crop?: PhotoCrop | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  return <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2c2c2e] text-lg font-semibold text-[#c7c7cc]" style={{ width: size, height: size }}>
    {src && failed !== src ? <Image unoptimized src={src} alt={`Profilbild von ${name}`} fill sizes={`${size}px`} className="object-cover" style={cropStyle(crop ?? DEFAULT_CROP)} onError={() => setFailed(src)} /> : <span aria-label={`Kein Foto von ${name}`}>{name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('')}</span>}
  </span>
}

export function PersonPortraitField({ value, crop, onPhoto, onCrop }: { value: string | null; crop: PhotoCrop; onPhoto: (photo: CatalogPhoto | null) => void; onCrop: (crop: PhotoCrop) => void }) {
  const image = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  return <PhotoField value={value} onChange={onPhoto} preview={<div className="flex flex-wrap items-center gap-6 rounded-xl border border-[#38383a] p-4">
    <div className="relative h-40 w-40 shrink-0 touch-none overflow-hidden rounded-full bg-[#2c2c2e]" style={{ cursor: value ? 'grab' : 'default' }}
      onPointerDown={event => { if (!value || loaded !== value) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop: { ...crop } } }}
      onPointerMove={event => { if (!drag.current || !image.current) return; onCrop(dragCrop(drag.current.crop, event.clientX - drag.current.x, event.clientY - drag.current.y, 160, image.current.naturalWidth, image.current.naturalHeight)) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      {value && failed !== value ? <Image ref={image} unoptimized src={value} alt="Vorschau des runden Profilbilds" fill sizes="160px" draggable={false} className="pointer-events-none object-cover" style={cropStyle(crop)} onLoad={() => setLoaded(value)} onError={() => setFailed(value)} /> : <span className="absolute inset-0 flex items-center justify-center text-sm text-[#c7c7cc]">Kein Foto</span>}
    </div>
    <div className="min-w-0 flex-1 space-y-3 text-sm text-[#c7c7cc]">
      <p className="font-medium text-white">Profilbild zuschneiden</p>
      <p>Bild im Kreis verschieben oder die Regler verwenden. Das Original bleibt erhalten.</p>
      {failed === value && value && <p role="alert" className="text-red-300">Foto konnte nicht geladen werden. Bitte ein anderes Bild auswählen.</p>}
      {(['zoom', 'x', 'y'] as const).map(key => <label key={key} className="flex items-center gap-3"><span className="w-24 shrink-0">{{ zoom: 'Zoom', x: 'Horizontal', y: 'Vertikal' }[key]}</span><input className="min-w-0 flex-1 accent-[#d4af37]" type="range" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 3 : 100} step={key === 'zoom' ? 0.01 : 1} value={crop[key]} disabled={!value} onChange={event => onCrop({ ...crop, [key]: Number(event.target.value) })} /></label>)}
      <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => onCrop({ ...DEFAULT_CROP })}>Ausschnitt zurücksetzen</Button>
    </div>
  </div>} />
}

'use client'

import { LocateFixed, Move, Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { mapCategory, type MapSpot } from '@/lib/map-spots'
import { formatDateTime } from '@/lib/utils'

export function SpotDetailDialog({
  spot,
  canManage,
  busy,
  onClose,
  onFocus,
  onEdit,
  onMove,
  onDelete,
}: {
  spot: MapSpot | null
  canManage: boolean
  busy: boolean
  onClose: () => void
  onFocus: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const category = spot ? mapCategory(spot.category) : null

  return (
    <Modal open={Boolean(spot)} onClose={onClose} title={spot?.title ?? 'Markierung'} size="xl">
      {spot && category && (
        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          {/* Kartenausschnitt: dasselbe Bild, stark vergrößert und auf die
              Koordinate zentriert – spart eine zweite, kleinere Kartendatei. */}
          <div className="relative min-h-56 overflow-hidden rounded-[11px] border border-[#2a2a2a] bg-[#111111]">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'url(/api/map/image)',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '420%',
                backgroundPosition: `${spot.x}% ${spot.y}%`,
              }}
            />
            <span
              className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-[#f4f4f4] text-[15px] leading-none shadow-md"
              style={{ background: category.hex, left: `${spot.x}%`, top: `${spot.y}%` }}
            >
              {spot.icon}
            </span>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[#a6a6a6]">
              <span className="h-2 w-2 rounded-full" style={{ background: category.hex }} />
              {category.label}
              <span className="ml-auto font-mono text-[11px] text-[#6a6a6a]">
                {spot.x.toFixed(1)} / {spot.y.toFixed(1)}
              </span>
            </div>

            <p className="mt-4 flex-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
              {spot.description || 'Für diese Markierung wurden keine Notizen hinterlegt.'}
            </p>

            <p className="mt-5 border-t border-[#232323] pt-3 text-[11.5px] text-[#6a6a6a]">
              {spot.createdByName} · {formatDateTime(spot.createdAt)}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={onFocus}>
                <LocateFixed className="h-4 w-4" />
                Auf Karte zeigen
              </Button>
              {canManage && (
                <>
                  <Button variant="outline" onClick={onEdit}>
                    <Pencil className="h-3.5 w-3.5" />
                    Bearbeiten
                  </Button>
                  <Button variant="outline" onClick={onMove}>
                    <Move className="h-3.5 w-3.5" />
                    Verschieben
                  </Button>
                  <Button variant="danger" loading={busy} onClick={onDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Löschen
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

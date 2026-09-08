'use client'

import { useMemo, useState } from 'react'
import { Crosshair, MoreHorizontal, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mapCategory, type MapSpot } from '@/lib/map-spots'
import { cn } from '@/lib/utils'

export function SpotList({
  spots,
  className,
  onFocus,
  onOpenDetail,
}: {
  spots: MapSpot[]
  className?: string
  onFocus: (spot: MapSpot) => void
  onOpenDetail: (spot: MapSpot) => void
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return spots
    return spots.filter(
      (spot) =>
        spot.title.toLowerCase().includes(term) ||
        spot.description.toLowerCase().includes(term) ||
        spot.createdByName.toLowerCase().includes(term),
    )
  }, [spots, query])

  return (
    <aside className={cn('flex h-full min-h-0 flex-col rounded-[12px] border border-[#2a2a2a] bg-[#141414]', className)}>
      <div className="border-b border-[#232323] p-3.5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold text-white">Markierungen</h2>
          <span className="font-mono text-[11px] text-[#6a6a6a]">{filtered.length}</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#808080]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Titel, Notizen oder Ersteller"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="mx-auto flex min-h-48 max-w-56 flex-col items-center justify-center text-center">
            <Crosshair className="mb-3 h-5 w-5 text-[#4a4a4a]" />
            <p className="text-[13px] font-medium text-white">Keine Markierungen</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[#808080]">
              Klicke auf eine freie Stelle der Karte, um eine Nadel zu setzen.
            </p>
          </div>
        ) : (
          filtered.map((spot) => (
            <div
              key={spot.id}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[9px] px-2 py-2 transition-colors hover:bg-[#181818]"
            >
              <button type="button" onClick={() => onFocus(spot)} className="contents text-left">
                <span
                  className="mt-1.5 h-2.5 w-2.5 rounded-full"
                  style={{ background: mapCategory(spot.category).hex }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-white">{spot.title}</span>
                  {spot.description && (
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-[#a6a6a6]">
                      {spot.description}
                    </span>
                  )}
                  <span className="mt-1 block truncate text-[10.5px] text-[#6a6a6a]">
                    {spot.createdByName}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                onClick={() => onOpenDetail(spot)}
                className="h-7 w-7 px-0"
                aria-label={`Details zu ${spot.title} öffnen`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <p className="border-t border-[#232323] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#6a6a6a]">
        Eintrag anklicken zum Fokussieren, Menü für Details.
      </p>
    </aside>
  )
}

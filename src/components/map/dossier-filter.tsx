'use client'

import { useMemo } from 'react'
import { Library, X } from 'lucide-react'

import type { MapSpot } from '@/lib/map-spots'
import { cn } from '@/lib/utils'

/**
 * Filtert die Karte auf die Punkte einer Dauerakte – „zeig mir alle Routen
 * und Sammler der Familie Moretti". Die Verknüpfungen liefert
 * `GET /api/map/spots` bereits mit, deshalb rein clientseitig.
 */
export function DossierFilter({
  spots,
  value,
  onChange,
}: {
  spots: MapSpot[]
  /** Id der gewählten Dauerakte, `null` = alle Punkte. */
  value: string | null
  onChange: (dossierId: string | null) => void
}) {
  const dossiers = useMemo(() => {
    const counts = new Map<string, { id: string; title: string; count: number }>()
    for (const spot of spots) {
      for (const dossier of spot.dossiers) {
        const entry = counts.get(dossier.id)
        if (entry) entry.count += 1
        else counts.set(dossier.id, { id: dossier.id, title: dossier.title, count: 1 })
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
  }, [spots])

  // Ohne verknüpfte Akten wäre der Filter eine leere Leiste.
  if (dossiers.length === 0) return null

  return (
    <div className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
          <Library size={13} />
          Dauerakten
        </h2>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-[10.5px] text-[#c4b5fd] hover:underline"
          >
            <X size={11} />
            Filter lösen
          </button>
        )}
      </div>

      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {dossiers.map((dossier) => {
          const isActive = value === dossier.id
          return (
            <button
              key={dossier.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(isActive ? null : dossier.id)}
              className={cn(
                'flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 text-left transition-colors',
                isActive ? 'bg-[#a78bfa]/10 text-[#c4b5fd]' : 'text-[#a6a6a6] hover:bg-[#1e1e1e] hover:text-white',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[11.5px]">{dossier.title}</span>
              <span className="font-mono text-[10.5px] text-[#6a6a6a]">{dossier.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Punkte einer Dauerakte. `null` lässt alles durch. */
export function filterSpotsByDossier(spots: MapSpot[], dossierId: string | null) {
  if (!dossierId) return spots
  return spots.filter((spot) => spot.dossiers.some((dossier) => dossier.id === dossierId))
}

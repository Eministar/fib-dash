'use client'

import { useMemo } from 'react'

import { MAP_CATEGORIES, type MapSpot } from '@/lib/map-spots'

export function MapLegend({ spots }: { spots: MapSpot[] }) {
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const spot of spots) result.set(spot.category, (result.get(spot.category) ?? 0) + 1)
    return result
  }, [spots])

  return (
    <div className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[12px] font-semibold text-white">Kategorien</h2>
        <span className="font-mono text-[10.5px] text-[#6a6a6a]">{spots.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-4 lg:grid-cols-2">
        {MAP_CATEGORIES.map((category) => (
          <div key={category.id} className="flex items-center gap-2 rounded-[7px] px-1 py-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: category.hex }} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#a6a6a6]">{category.label}</span>
            <span className="font-mono text-[10.5px] text-[#6a6a6a]">
              {counts.get(category.id) ?? 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

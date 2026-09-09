'use client'

import { cn } from '@/lib/utils'

export type TabItem = {
  id: string
  label: string
  /** Wird als Zähler rechts am Reiter angezeigt. `undefined` blendet ihn aus. */
  count?: number
}

/**
 * Reiter im Stil der Bereichsnavigation. Bewusst dieselbe Chip-Optik: zwei
 * verschiedene Umschalt-Sprachen auf einer Seite lernt niemand gern.
 */
export function TabBar({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: TabItem[]
  active: string
  onSelect: (id: string) => void
  label: string
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/35',
              isActive
                ? 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#c4b5fd]'
                : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[10.5px]',
                  isActive ? 'bg-[#a78bfa]/20 text-[#c4b5fd]' : 'bg-[#232323] text-[#808080]',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Fällt auf den ersten Reiter zurück, damit ein veralteter oder erfundener
 *  `?tab=`-Parameter aus einem geteilten Link keine leere Seite zeigt. */
export function resolveTab(requested: string | null | undefined, tabs: TabItem[]): string {
  if (requested && tabs.some((tab) => tab.id === requested)) return requested
  return tabs[0].id
}

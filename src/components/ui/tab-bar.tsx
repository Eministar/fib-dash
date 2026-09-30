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
    <div className="mb-5 inline-flex max-w-full flex-wrap gap-[2px] rounded-[9px] bg-[#1c1c1e] p-[3px]" role="tablist" aria-label={label}>
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
              'inline-flex h-8 items-center gap-2 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0a84ff]/50',
              isActive
                ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]'
                : 'text-[#98989d] hover:text-white',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[11px]',
                  isActive ? 'bg-white/15 text-white' : 'bg-[#2c2c2e] text-[#8e8e93]',
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

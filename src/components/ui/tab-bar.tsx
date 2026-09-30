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
                : 'border-line/60 bg-surface-sunken/55 text-fg-muted hover:border-line-strong hover:text-white',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 font-mono text-[11px]',
                  isActive ? 'bg-[#a78bfa]/20 text-[#c4b5fd]' : 'bg-surface-raised text-fg-subtle',
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

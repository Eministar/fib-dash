'use client'

import { cn } from '@/lib/utils'

export type TabItem = {
  id: string
  label: string
  /** Wird als Zähler rechts am Reiter angezeigt. `undefined` blendet ihn aus. */
  count?: number
}

/** Flache Bereichsnavigation mit einer Zeile und Tastatursteuerung. */
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
    <div className="mb-4 flex max-w-full gap-5 overflow-x-auto border-b border-[#38383a]/70" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              const index = tabs.findIndex((item) => item.id === tab.id)
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
              if (next === null) return
              event.preventDefault()
              onSelect(tabs[next].id)
              const target = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
              target?.focus({ preventScroll: true })
              target?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
            }}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-1 text-[13px] font-medium active:text-white',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0a84ff]',
              isActive
                ? 'border-[#d4d4d4] text-white'
                : 'border-transparent text-[#98989d] hover:text-white',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded px-1.5 tabular-nums text-[11px]',
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

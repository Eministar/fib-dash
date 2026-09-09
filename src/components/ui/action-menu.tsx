'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type ActionMenuItem = {
  id: string
  label: string
  icon?: LucideIcon
  onSelect: () => void
  /** Hebt zerstörende Aktionen rot hervor. */
  danger?: boolean
}

/**
 * Überlaufmenü für seltene Aktionen. Hält die Kopfzeile bei einer einzigen
 * hervorgehobenen Hauptaktion, statt vier gleich laute Knöpfe nebeneinander
 * zu stellen.
 */
export function ActionMenu({ items, label = 'Weitere Aktionen' }: { items: ActionMenuItem[]; label?: string }) {
  if (items.length === 0) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#343434]/70 bg-[#181818]/60',
            'text-[#a6a6a6] transition-colors hover:border-[#404040] hover:text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/35',
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[200px] rounded-[11px] border border-[#323232] bg-[#181818] p-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        >
          {items.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenu.Item
                key={item.id}
                onSelect={item.onSelect}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-2 text-[12.5px] outline-none',
                  item.danger
                    ? 'text-[#fca5a5] data-[highlighted]:bg-[#7f1d1d]/25'
                    : 'text-[#d4d4d4] data-[highlighted]:bg-[#232323] data-[highlighted]:text-white',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {item.label}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

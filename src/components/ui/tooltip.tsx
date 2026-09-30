'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

/** Einmal um die App gelegt; kurze Verzögerung, beim Weiterwandern sofort. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

/**
 * Ersatz für `title=""`: erscheint schneller, im Dashboard-Look und auch bei
 * Tastaturfokus. Das Kind muss ein fokussierbares Element sein (Button, Link).
 * Für reine Icon-Knöpfe trotzdem `aria-label` setzen – der Tooltip ist Zusatz.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="tooltip-content z-[120] max-w-[260px] rounded-[7px] border border-[#38383a] bg-[#1c1c1e] px-2.5 py-1.5 text-[12px] font-medium leading-snug text-[#f5f5f7] shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

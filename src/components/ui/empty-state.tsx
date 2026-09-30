'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'

/**
 * Leerzustand mit Ausweg. Ein „Nichts gefunden." ohne Knopf lässt den
 * Benutzer in einer Sackgasse stehen – deshalb ist `action` die Regel und
 * nicht die Ausnahme.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  inline = false,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  /** Ohne eigenen Kartenrahmen – für Leerzustände innerhalb einer bestehenden Karte. */
  inline?: boolean
}) {
  const content = (
    <>
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#d4d4d4]/10 bg-[#d4d4d4]/5">
        <Icon className="h-[18px] w-[18px] text-[#8a8a8a]" strokeWidth={1.6} />
      </span>
      <p className="mt-3 text-[13.5px] text-[#c4c4c4]">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[#909090]">{hint}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </>
  )
  if (inline) return <div className="py-10 text-center">{content}</div>
  return <Card className="py-12 text-center">{content}</Card>
}

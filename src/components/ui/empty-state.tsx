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
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <Card className="py-12 text-center">
      <Icon className="mx-auto h-8 w-8 text-[#4a4a4a]" />
      <p className="mt-3 text-[13.5px] text-[#c4c4c4]">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-[#808080]">{hint}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </Card>
  )
}

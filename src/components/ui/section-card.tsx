'use client'

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Einheitlicher Abschnitt für alle Aktenansichten: Titel, Zähler, eine
 * Aktion – und der Leertext, wenn nichts drin ist. Vorher hatte jeder
 * Abschnitt seinen eigenen handgebauten Kopf mit eigener Zählerlogik.
 */
export function SectionCard({
  title,
  count,
  action,
  empty,
  children,
  className,
}: {
  title: string
  count?: number
  action?: ReactNode
  /** Wird statt `children` gezeigt, wenn `count` 0 ist. */
  empty?: string
  children?: ReactNode
  className?: string
}) {
  const isEmpty = count === 0

  return (
    <Card className={cn('mb-4', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-[#232323] px-1.5 font-mono text-[10.5px] text-[#909090]">{count}</span>
          )}
        </h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {isEmpty && empty ? <p className="py-3 text-[12.5px] text-[#6a6a6a]">{empty}</p> : children}
    </Card>
  )
}

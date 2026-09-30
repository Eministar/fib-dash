import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export type Crumb = { label: string; href?: string }

/**
 * Pfad zur aktuellen Seite („Agents › Max Mustermann › Personalakte“).
 * Ersetzt die verstreuten „Zurück“-Knöpfe: Man sieht, wo man ist, und
 * springt mit einem Klick eine oder zwei Ebenen hoch.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Brotkrumen" className={cn('mb-2.5', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-[#909090]">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="truncate rounded-[5px] transition-colors hover:text-white">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn('truncate', last && 'text-[#c4c4c4]')}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight size={13} className="shrink-0 text-[#8c8c8c]" aria-hidden />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

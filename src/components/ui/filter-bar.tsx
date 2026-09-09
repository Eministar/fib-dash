'use client'

import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Filterzeile über einer Liste. Das Suchfeld nimmt den Platz, die übrigen
 *  Filter behalten ihre natürliche Breite. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-5 flex flex-wrap items-center gap-3', className)}>{children}</div>
}

/** Suchfeld mit Lupe – überall dasselbe. Vorher hatte mal die eine, mal die
 *  andere Ansicht ein Icon im Feld. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label = 'Suchen',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-[240px] flex-1', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#808080]" />
      <Input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  )
}

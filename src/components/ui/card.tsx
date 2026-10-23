import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
      <div className={cn(
          // Flache Gruppen-Fläche wie in den macOS-Einstellungen.
          'rounded-[12px] bg-[#1c1c1e]',
          padding && 'p-5',
          className
      )}>
        {children}
      </div>
  )
}


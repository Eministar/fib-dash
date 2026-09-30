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

interface CardHeaderProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
      <div className={cn('flex items-start justify-between gap-4 mb-4', className)}>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-white tracking-[-0.01em]">{title}</h3>
          {description && <p className="text-[12px] text-[#98989d] mt-1 leading-relaxed">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
  )
}
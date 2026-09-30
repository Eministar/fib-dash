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
          'rounded-[16px] border border-[#323232]/55 bg-[#1b1b1b]/70 backdrop-blur-md shadow-[0_1px_2px_rgba(0,0,0,0.12),0_8px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(212,212,212,0.04)]',
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
          {description && <p className="text-[12px] text-[#a6a6a6] mt-1 leading-relaxed">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
  )
}
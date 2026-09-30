import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  const variants = {
    default: 'bg-[#232323]/80 text-[#f4f4f4] border-[#363636]/40',
    success: 'bg-[#123026]/80 text-[#86efac] border-[#1a4d3a]/40',
    warning: 'bg-[#302712]/80 text-[#d4d4d4] border-[#4a3a12]/40',
    danger: 'bg-[#2a1620]/80 text-[#fca5a5] border-[#4a1a2a]/40',
    info: 'bg-[#232323]/80 text-[#93c5fd] border-[#363636]/40',
  }

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-[3px] rounded-[6px] text-[11.5px] font-medium border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

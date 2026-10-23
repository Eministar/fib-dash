import { Plane } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Ersetzt das frühere „[X]“-Präfix: sichtbar als Wort, nicht als Kürzel. */
export function OnLeaveBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-[#a78bfa]/30 bg-[#161225]/80 font-medium text-[#c4b5fd] whitespace-nowrap',
        compact ? 'px-1.5 py-[1px] text-[10.5px]' : 'px-2 py-[3px] text-[11.5px]',
        className,
      )}
    >
      <Plane size={compact ? 10 : 12} strokeWidth={2} aria-hidden />
      Beurlaubt
    </span>
  )
}

import { cn } from '@/lib/utils'

export function RankNumberBadge({
  number,
  className,
}: {
  number: number | null | undefined
  className?: string
}) {
  if (number == null) return null

  return (
    <span
      title={`Interne Rangnummer ${number}`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-[6px] border border-accent/25 bg-accent/[0.07] px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-[0.04em] text-[#d8bd67]',
        className,
      )}
    >
      Rang {number}
    </span>
  )
}

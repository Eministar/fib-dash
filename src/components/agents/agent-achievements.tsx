'use client'

import { Award, CalendarClock, Crown, FolderCheck, GraduationCap, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useFetch } from '@/hooks/use-fetch'
import type { Achievement, AchievementCategory } from '@/lib/achievements'
import { cn } from '@/lib/utils'

const ICONS: Record<AchievementCategory, LucideIcon> = {
  service: CalendarClock,
  duty: Timer,
  training: GraduationCap,
  cases: FolderCheck,
  honor: Crown,
}

const TIER_STYLE: Record<Achievement['tier'], string> = {
  1: 'border-[#b08968]/40 bg-[#b08968]/10 text-[#d6b08c]',
  2: 'border-[#c7c7c7]/35 bg-[#c7c7c7]/10 text-[#e5e5ea]',
  3: 'border-[#e3c26b]/45 bg-[#e3c26b]/10 text-[#f1d68f]',
}

const TIER_LABEL: Record<Achievement['tier'], string> = { 1: 'Bronze', 2: 'Silber', 3: 'Gold' }

/** Abzeichen der Personalakte – berechnet aus Dienstzeit, Ausbildungen, Fällen und Ehrungen. */
export function AgentAchievements({ agentId }: { agentId: string }) {
  const { data } = useFetch<Achievement[]>(`/api/agents/${agentId}/achievements`)

  return (
    <div className="glass-panel-elevated rounded-[14px] p-5">
      <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-[#eee]">
        <Award size={15} className="text-[#8e8e93]" />
        Abzeichen
      </h3>
      {!data ? (
        <div className="h-16 animate-pulse rounded-[10px] bg-[#1c1c1e]/60" aria-hidden />
      ) : data.length === 0 ? (
        <p className="text-[12.5px] text-[#8e8e93]">Noch keine Abzeichen.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((item) => {
            const Icon = ICONS[item.category]
            return (
              <li key={item.id} className="flex items-center gap-3">
                <span
                  className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full border', TIER_STYLE[item.tier])}
                  title={TIER_LABEL[item.tier]}
                >
                  <Icon size={16} strokeWidth={1.85} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-white">
                    {item.title}
                    <span className="sr-only"> ({TIER_LABEL[item.tier]})</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-[#8e8e93]" title={item.description}>{item.description}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

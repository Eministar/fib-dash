'use client'

import Link from 'next/link'
import { FileSearch, FileText, ScrollText, UserX } from 'lucide-react'

import { cn } from '@/lib/utils'

export type InternalAffairsSection =
  | 'documents'
  | 'searches'
  | 'investigations'
  | 'terminations'

const sections: { id: InternalAffairsSection; label: string; href: string; icon: typeof FileText }[] = [
  { id: 'documents', label: 'Dokumente', href: '/internal-affairs', icon: FileText },
  { id: 'searches', label: 'Durchsuchungen', href: '/internal-affairs?tab=searches', icon: FileSearch },
  { id: 'investigations', label: 'DAWs & Ermittlungen', href: '/internal-affairs/investigations', icon: ScrollText },
  { id: 'terminations', label: 'Kündigungen', href: '/internal-affairs/terminations', icon: UserX },
]

export function InternalAffairsNavigation({ active }: { active: InternalAffairsSection }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Internal Affairs Bereiche">
      {sections.map((section) => {
        const Icon = section.icon
        const isActive = active === section.id

        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9]/35',
              isActive
                ? 'border-[#0ea5e9]/40 bg-[#0ea5e9]/10 text-[#7dd3fc]'
                : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
            )}
          >
            <Icon size={14} strokeWidth={2} />
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}

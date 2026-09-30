'use client'

import Link from 'next/link'
import { FileText, Scale } from 'lucide-react'

import { cn } from '@/lib/utils'

export type LegalAffairsSection = 'documents' | 'cases'

const sections: { id: LegalAffairsSection; label: string; href: string; icon: typeof FileText }[] = [
  { id: 'documents', label: 'Dokumente', href: '/lad', icon: FileText },
  { id: 'cases', label: 'Klagen', href: '/lad?tab=cases', icon: Scale },
]

export function LegalAffairsNavigation({ active }: { active: LegalAffairsSection }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Legal Affairs Bereiche">
      {sections.map((section) => {
        const Icon = section.icon
        const isActive = active === section.id

        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]/35',
              isActive
                ? 'border-[#8b5cf6]/40 bg-[#8b5cf6]/10 text-[#c4b5fd]'
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

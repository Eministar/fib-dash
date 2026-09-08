'use client'

import Link from 'next/link'
import { Car, FolderOpen, UserSearch, Video, Images, Folders } from 'lucide-react'

import { cn } from '@/lib/utils'

export type InvestigationsSection = 'cases' | 'clips' | 'persons' | 'vehicles' | 'photos' | 'dossiers'

const sections: { id: InvestigationsSection; label: string; href: string; icon: typeof FolderOpen }[] = [
  { id: 'cases', label: 'Einsatzakten', href: '/investigations', icon: FolderOpen },
  { id: 'clips', label: 'Bodycam-Katalog', href: '/investigations/clips', icon: Video },
  { id: 'persons', label: 'Personenregister', href: '/investigations/persons', icon: UserSearch },
  { id: 'photos', label: 'Bildkatalog', href: '/investigations/photos', icon: Images },
  { id: 'dossiers', label: 'Dauerakten', href: '/investigations/dossiers', icon: Folders },
  { id: 'vehicles', label: 'Fahrzeugregister', href: '/investigations/vehicles', icon: Car },
]

export function InvestigationsNavigation({ active }: { active: InvestigationsSection }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Ermittlungsbereiche">
      {sections.map((section) => {
        const Icon = section.icon
        const isActive = active === section.id

        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]/35',
              isActive
                ? 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#c4b5fd]'
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

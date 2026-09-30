'use client'

import Link from 'next/link'
import { Car, FolderOpen, Library, Share2, UserSearch, Video, Images, ChevronDown } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { usePersistentBoolean } from '@/hooks/use-persistent-boolean'

export type InvestigationsSection = 'cases' | 'clips' | 'persons' | 'vehicles' | 'photos' | 'dossiers' | 'shares'
const sections = [
  { id: 'cases', label: 'Einsatzakten', href: '/investigations', icon: FolderOpen, group: 'Akten' },
  { id: 'dossiers', label: 'Dauerakten', href: '/investigations/dossiers', icon: Library, group: 'Akten' },
  { id: 'persons', label: 'Personen', href: '/investigations/persons', icon: UserSearch, group: 'Akten' },
  { id: 'vehicles', label: 'Fahrzeuge', href: '/investigations/vehicles', icon: Car, group: 'Akten' },
  { id: 'clips', label: 'Bodycams', href: '/investigations/clips', icon: Video, group: 'Material' },
  { id: 'photos', label: 'Bilder', href: '/investigations/photos', icon: Images, group: 'Material' },
  { id: 'shares', label: 'Freigaben', href: '/investigations/shares', icon: Share2, group: 'Material' },
]

export function InvestigationsNavigation({ active }: { active: InvestigationsSection }) {
  const { user } = useAuth()
  const [guideOpen, setGuideOpen] = usePersistentBoolean(`fib:investigations:guide:${user?.id ?? 'guest'}`, true)
  return <div className="mb-5">
    <nav className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-3" aria-label="Ermittlungsbereiche">
      {['Akten', 'Material'].map(group => <div key={group} className="flex flex-wrap items-center gap-1">
        {sections.filter(section => section.group === group && (section.id !== 'shares' || hasPermission(user, 'investigations:manage'))).map(section => <Link
          key={section.id} href={section.href} prefetch={false} aria-current={active === section.id ? 'page' : undefined}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] focus-visible:outline focus-visible:outline-2 ${active === section.id ? 'bg-[#303030] font-medium text-white' : 'text-fg-muted hover:bg-[#252525]'}`}>
          <section.icon size={15} />{section.label}
        </Link>)}
      </div>)}
    </nav>
    <button type="button" onClick={() => setGuideOpen(!guideOpen)} aria-expanded={guideOpen} className="mt-3 flex items-center gap-2 text-xs text-fg-muted hover:text-white">Welche Akte brauche ich?<ChevronDown size={13} className={guideOpen ? '' : '-rotate-90'} /></button>
    {guideOpen && <div className="mt-3 grid gap-3 text-xs leading-5 sm:grid-cols-3">
      <p><strong className="font-medium text-[#e5e5e5]">Einsatzakte: ein konkreter Vorfall.</strong><br /><span className="text-[#909090]">Ablauf, Beteiligte, Beweise und Ergebnis dokumentieren.</span></p>
      <p><strong className="font-medium text-[#e5e5e5]">Dauerakte: der größere Zusammenhang.</strong><br /><span className="text-[#909090]">Einsätze einer Fraktion, Familie oder eines Anwesens bündeln.</span></p>
      <p><strong className="font-medium text-[#e5e5e5]">Register: Personen und Fahrzeuge.</strong><br /><span className="text-[#909090]">Einmal erfassen und mit den passenden Akten verknüpfen.</span></p>
    </div>}
  </div>
}

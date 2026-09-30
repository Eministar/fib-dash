import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export type PublicSection = 'start' | 'bewerbung' | 'presse' | 'aushang'

export const PUBLIC_LINKS: { id: PublicSection; label: string; href: string }[] = [
  { id: 'start', label: 'Start', href: '/besucherportal' },
  { id: 'bewerbung', label: 'Bewerbung', href: '/besucherportal/bewerbung' },
  { id: 'presse', label: 'Presse', href: '/besucherportal/presse' },
  { id: 'aushang', label: 'Schwarzes Brett', href: '/aushang' },
]

/**
 * Gemeinsamer Rahmen aller öffentlichen Seiten – gleiche Farben, Panels und
 * Abstände wie das Dashboard, damit Portal und Dashboard zusammenpassen.
 * Ohne Hooks, damit Server- und Client-Seiten ihn nutzen können.
 */
export function PublicShell({ active, actions, children }: { active?: PublicSection; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-[#0d0d0d]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/besucherportal" className="flex shrink-0 items-center gap-2.5 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2">
            <Image src="/shield.webp" alt="" width={28} height={28} />
            <span className="hidden sm:inline">Federal Investigation Bureau</span>
            <span className="sm:hidden">FIB</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-[12.5px] text-fg-muted">{actions}</div>
        </div>
        <nav aria-label="Öffentlicher Bereich" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2 sm:px-5">
          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              aria-current={active === link.id ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2',
                active === link.id ? 'bg-[#262626] text-white' : 'text-fg-muted hover:bg-[#1c1c1c] hover:text-white',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-line/60 py-5 text-center text-[11.5px] text-fg-subtle">
        Federal Investigation Bureau · Öffentlicher Bereich
      </footer>
    </div>
  )
}

export function PublicPageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold tracking-tight text-white">{title}</h1>
      {description && <p className="mt-1.5 text-[13px] leading-6 text-fg-muted">{description}</p>}
    </div>
  )
}

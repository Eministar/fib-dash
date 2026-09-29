'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Briefcase, Megaphone, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { formatDate, formatDateTime } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import { JOB_APPLICATION_STATUS_META, type JobApplicationStatusValue } from '@/lib/job-applications'
import { renderMarkdown } from '@/lib/markdown'
import { pressReleaseExcerpt, type PressReleaseStatusValue } from '@/lib/press-releases'

interface PublicAgent {
  badgeNumber: string
  firstName: string
  lastName: string
  hireDate: string
  unit: string | null
  units: string[] | null
  unitInfo: { key: string; name: string; color: string }[]
  rank: { name: string; color: string; sortOrder: number }
}

interface PublicPressRelease {
  id: string
  title: string
  slug: string
  summary: string | null
  content: string
  imageUrl: string | null
  imageAlt: string | null
  status: PressReleaseStatusValue
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; displayName: string } | null
}

interface PortalApplication {
  id: string
  caseNumber: string | null
  status: JobApplicationStatusValue
  statusText: string
  submittedAt: string
  updatedAt: string
}

interface ApplicationPortalPayload {
  application: PortalApplication | null
}


type Section = 'start' | 'bewerbung' | 'presse' | 'mitarbeiter'
const links = [
  { id: 'start', label: 'Start', href: '/besucherportal' },
  { id: 'bewerbung', label: 'Bewerbung', href: '/besucherportal/bewerbung' },
  { id: 'presse', label: 'Presse', href: '/besucherportal/presse' },
  { id: 'mitarbeiter', label: 'Mitarbeiter', href: '/besucherportal/mitarbeiter' },
]

export function VisitorPortal({ section = 'start', pressId }: { section?: Section; pressId?: string }) {
  const { user, loading: authLoading, logout } = useAuth()
  const press = useFetch<PublicPressRelease[]>(section === 'presse' ? '/api/press-releases' : null, 120_000)
  const staff = useFetch<PublicAgent[]>(section === 'mitarbeiter' ? '/api/public/agents' : null, 120_000)
  const application = useFetch<ApplicationPortalPayload>(section === 'bewerbung' && !authLoading && user ? '/api/applications/me' : null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const rows = useMemo(() => (staff.data ?? []).filter(agent =>
    [agent.firstName, agent.lastName, displayBadgeNumber(agent.badgeNumber), agent.rank.name, ...agent.unitInfo.map(unit => unit.name)]
      .join(' ').toLocaleLowerCase('de-DE').includes(search.trim().toLocaleLowerCase('de-DE'))
  ), [search, staff.data])
  const article = press.data?.find(item => item.id === pressId)
  const html = useMemo(() => article ? renderMarkdown(article.content) : '', [article])
  const currentApplication = application.data?.application

  return <main className="min-h-screen bg-[#181818] text-[#f4f4f4]">
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#343434] pb-4">
        <Link href="/besucherportal" className="flex items-center gap-2.5 text-sm font-semibold"><Image src="/shield.webp" alt="" width={30} height={30} />FIB Besucherportal</Link>
        <div className="flex items-center gap-4 text-xs text-[#a6a6a6]">
          {user ? <>
            {user.permissions.some(permission => permission !== 'password:change') && <Link href="/dashboard" className="hover:text-white">Dashboard</Link>}
            <button type="button" onClick={() => void logout()} className="hover:text-white">Abmelden</button>
          </> : <Link href="/login">Mitarbeiter-Login</Link>}
        </div>
      </header>
      <nav aria-label="Besucherportal" className="mb-8 flex gap-5 overflow-x-auto border-b border-[#343434]">
        {links.map(link => <Link key={link.id} href={link.href} aria-current={section === link.id ? 'page' : undefined}
          className={`shrink-0 border-b-2 py-3 text-sm ${section === link.id ? 'border-[#d4d4d4] text-white' : 'border-transparent text-[#909090] hover:text-white'}`}>{link.label}</Link>)}
      </nav>

      {section === 'start' && <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Willkommen beim FIB</h1>
        <p className="mt-2 text-sm text-[#a6a6a6]">Was möchtest du erledigen?</p>
        <div className="mt-6 divide-y divide-[#343434] border-y border-[#343434]">
          {[
            { href: '/besucherportal/bewerbung', title: 'Bewerben oder Status prüfen', description: 'Bewerbung einreichen und den Bearbeitungsstand verfolgen.', icon: Briefcase },
            { href: '/besucherportal/presse', title: 'Pressemitteilungen lesen', description: 'Aktuelle Veröffentlichungen des Departments.', icon: Megaphone },
            { href: '/besucherportal/mitarbeiter', title: 'Mitarbeiter finden', description: 'Nach Namen, Dienstnummer, Rang oder Unit suchen.', icon: Users },
          ].map(item => <Link key={item.href} href={item.href} className="flex items-center gap-4 py-5 hover:bg-[#212121] focus-visible:outline focus-visible:outline-2">
            <item.icon size={20} className="shrink-0 text-[#a6a6a6]" /><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{item.title}</h2><p className="mt-1 text-xs leading-5 text-[#909090]">{item.description}</p></div><ArrowRight size={16} />
          </Link>)}
        </div>
      </section>}

      {section === 'bewerbung' && <section className="max-w-xl space-y-5">
        <div><h1 className="text-2xl font-semibold">Deine Bewerbung</h1><p className="mt-2 text-sm text-[#a6a6a6]">Einreichen, Bearbeitungsstand prüfen und nächste Schritte sehen.</p></div>
        {authLoading ? <p role="status">Anmeldung wird geprüft …</p> : !user ? <div className="rounded-lg border border-[#343434] p-5">
          <h2 className="text-base font-medium">Mit Discord anmelden</h2><p className="my-3 text-sm leading-6 text-[#a6a6a6]">Deine Bewerbung wird mit deinem Discord-Konto verknüpft. So kannst du den Status später wieder aufrufen.</p>
          <a href="/api/auth/discord/login?mode=application&remember=1" className="inline-block rounded-md bg-[#d4d4d4] px-4 py-2 text-sm font-medium text-[#181818]">Mit Discord fortfahren</a>
        </div> : <>
          {application.loading ? <p role="status">Bewerbung wird geladen …</p> : application.error ? <PortalError message={application.error} retry={application.refetch} /> : currentApplication ? <div className="space-y-3 rounded-lg border border-[#343434] p-5">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={JOB_APPLICATION_STATUS_META[currentApplication.status].variant}>{JOB_APPLICATION_STATUS_META[currentApplication.status].label}</Badge>{currentApplication.caseNumber && <span className="text-xs text-[#a6a6a6]">{currentApplication.caseNumber}</span>}</div>
            <p className="text-sm leading-6">{currentApplication.statusText}</p><p className="text-xs text-[#909090]">Aktualisiert: {formatDateTime(currentApplication.updatedAt)}</p>
          </div> : <p className="text-sm text-[#a6a6a6]">Du hast noch keine Bewerbung eingereicht.</p>}
          <Link href="/bewerbung" className="inline-block rounded-md bg-[#d4d4d4] px-4 py-2 text-sm font-medium text-[#181818]">{currentApplication ? 'Bewerbung ansehen' : 'Bewerbung beginnen'}</Link>
        </>}
      </section>}

      {section === 'presse' && <section className="max-w-3xl">
        {pressId && <Link href="/besucherportal/presse" className="mb-4 inline-block text-sm text-[#a6a6a6] hover:text-white">Zurück zu allen Mitteilungen</Link>}
        <h1 className="text-2xl font-semibold">{article?.title ?? 'Pressemitteilungen'}</h1>
        {press.loading ? <p role="status" className="py-6 text-sm">Mitteilungen werden geladen …</p> : press.error ? <PortalError message={press.error} retry={press.refetch} /> : pressId ? article ? <article className="mt-5">
          <p className="mb-4 text-xs text-[#909090]">{formatDate(article.publishedAt ?? article.createdAt)}</p>
          {article.imageUrl && <Image unoptimized src={article.imageUrl} alt={article.imageAlt ?? article.title} width={900} height={450} className="mb-5 max-h-80 w-full rounded-lg object-cover" />}
          {article.summary && <p className="mb-5 text-sm leading-6 text-[#c3c3c3]">{article.summary}</p>}
          <div className="markdown-document text-sm leading-7" dangerouslySetInnerHTML={{ __html: html }} />
        </article> : <p className="py-6 text-sm">Diese Mitteilung ist nicht verfügbar.</p> : <div className="mt-5 divide-y divide-[#343434]">
          {(press.data ?? []).map(item => <Link key={item.id} href={`/besucherportal/presse/${item.id}`} className="block py-5 hover:bg-[#212121]">
            <p className="text-xs text-[#909090]">{formatDate(item.publishedAt ?? item.createdAt)}</p><h2 className="mt-1 text-base font-medium">{item.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 text-[#a6a6a6]">{item.summary || pressReleaseExcerpt(item.content)}</p>
          </Link>)}
          {!press.data?.length && <p className="py-5 text-sm text-[#909090]">Noch keine Mitteilungen veröffentlicht.</p>}
        </div>}
      </section>}

      {section === 'mitarbeiter' && <section>
        <h1 className="text-2xl font-semibold">Mitarbeiter finden</h1>
        <label className="mt-5 block max-w-md text-xs text-[#a6a6a6]">Name, Dienstnummer, Rang oder Unit
          <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} className="mt-2 h-10 w-full rounded-md border border-[#404040] bg-[#212121] px-3 text-sm text-white focus:outline-2 focus:outline-[#a6a6a6]" placeholder="Suchen …" />
        </label>
        {staff.loading ? <p role="status" className="py-6 text-sm">Mitarbeiter werden geladen …</p> : staff.error ? <PortalError message={staff.error} retry={staff.refetch} /> : <>
          <p className="my-4 text-xs text-[#909090]">{rows.length} Treffer</p>
          <ul className="divide-y divide-[#343434] border-y border-[#343434]">{rows.slice((page - 1) * 20, page * 20).map(agent => <li key={`${agent.badgeNumber}:${agent.firstName}:${agent.lastName}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div><p className="font-medium">{agent.firstName} {agent.lastName} <span className="ml-2 text-xs font-normal text-[#909090]">{displayBadgeNumber(agent.badgeNumber)}</span></p><p className="mt-1 text-xs text-[#a6a6a6]">{agent.rank.name}</p></div><p className="text-xs text-[#909090]">{agent.unitInfo.map(unit => unit.name).join(', ') || 'Keine Unit'}</p>
          </li>)}</ul>
          {!rows.length && <p className="py-5 text-sm text-[#909090]">Keine passenden Mitarbeiter. Probiere einen anderen Suchbegriff.</p>}
          {rows.length > 20 && <div className="mt-4 flex items-center justify-between"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Zurück</Button><span className="text-xs text-[#909090]">Seite {page} von {Math.ceil(rows.length / 20)}</span><Button size="sm" variant="ghost" disabled={page * 20 >= rows.length} onClick={() => setPage(page + 1)}>Weiter</Button></div>}
        </>}
      </section>}
      <footer className="mt-12 border-t border-[#343434] pt-4 text-xs text-[#808080]">Federal Investigation Bureau</footer>
    </div>
  </main>
}

function PortalError({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div role="alert" className="my-5 space-y-3"><p className="text-sm text-red-300">{message}</p><Button size="sm" variant="outline" onClick={() => void retry()}>Erneut laden</Button></div>
}

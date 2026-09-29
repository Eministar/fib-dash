'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, ClipboardList, Briefcase, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { formatDate, formatDateTime } from '@/lib/utils'
import { JOB_APPLICATION_STATUS_META, type JobApplicationStatusValue } from '@/lib/job-applications'
import { renderMarkdown } from '@/lib/markdown'
import { pressReleaseExcerpt, type PressReleaseStatusValue } from '@/lib/press-releases'
import { PublicPageTitle, PublicShell } from '@/components/portal/public-shell'

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

type Section = 'start' | 'bewerbung' | 'presse'

const primaryAction = 'inline-flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[#d4d4d4] px-3.5 text-[13px] font-medium text-[#181818] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2'

const START_ITEMS = [
  { href: '/besucherportal/bewerbung', title: 'Bewerben oder Status prüfen', description: 'Bewerbung einreichen und den Bearbeitungsstand verfolgen.', icon: Briefcase },
  { href: '/besucherportal/presse', title: 'Pressemitteilungen', description: 'Aktuelle Veröffentlichungen des Bureaus.', icon: Megaphone },
  { href: '/aushang', title: 'Schwarzes Brett', description: 'Öffentliche Schreiben, Bekanntmachungen und Listen.', icon: ClipboardList },
]

export function VisitorPortal({ section = 'start', pressId }: { section?: Section; pressId?: string }) {
  const { user, loading: authLoading, logout } = useAuth()
  const press = useFetch<PublicPressRelease[]>(section === 'presse' ? '/api/press-releases' : null, 120_000)
  const application = useFetch<ApplicationPortalPayload>(section === 'bewerbung' && !authLoading && user ? '/api/applications/me' : null)
  const article = press.data?.find(item => item.id === pressId)
  const html = useMemo(() => article ? renderMarkdown(article.content) : '', [article])
  const currentApplication = application.data?.application

  const actions = user
    ? <>
      {user.permissions.some(permission => permission !== 'password:change') && <Link href="/dashboard" className="hover:text-white">Zum Dashboard</Link>}
      <button type="button" onClick={() => void logout()} className="hover:text-white">Abmelden</button>
    </>
    : <Link href="/login" className="hover:text-white">Mitarbeiter-Login</Link>

  return <PublicShell active={section} actions={actions}>
    {section === 'start' && <section>
      <PublicPageTitle title="Willkommen beim FIB" description="Öffentlicher Bereich des Federal Investigation Bureau. Was möchtest du erledigen?" />
      <ul className="glass-panel-elevated divide-y divide-[#2c2c2c] overflow-hidden rounded-[14px]">
        {START_ITEMS.map(item => <li key={item.href}>
          <Link href={item.href} className="group flex items-center gap-4 px-5 py-4 hover:bg-[#232323] focus-visible:outline focus-visible:outline-2">
            <span className="icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-[10px]"><item.icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-white">{item.title}</span>
              <span className="mt-0.5 block text-[12.5px] text-[#909090]">{item.description}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[#6f6f6f] group-hover:text-white" aria-hidden />
          </Link>
        </li>)}
      </ul>
    </section>}

    {section === 'bewerbung' && <section className="max-w-2xl">
      <PublicPageTitle title="Deine Bewerbung" description="Einreichen, Bearbeitungsstand prüfen und nächste Schritte sehen." />
      {authLoading ? <p role="status" className="text-[13px] text-[#a6a6a6]">Anmeldung wird geprüft …</p> : !user ? <div className="glass-panel-elevated rounded-[14px] p-5">
        <h2 className="text-[15px] font-semibold text-white">Mit Discord anmelden</h2>
        <p className="mb-4 mt-2 text-[13px] leading-6 text-[#a6a6a6]">Deine Bewerbung wird mit deinem Discord-Konto verknüpft. So kannst du den Status später wieder aufrufen.</p>
        <a href="/api/auth/discord/login?mode=application&remember=1" className={primaryAction}>Mit Discord fortfahren</a>
      </div> : <div className="space-y-4">
        {application.loading && !application.data ? <p role="status" className="text-[13px] text-[#a6a6a6]">Bewerbung wird geladen …</p> : application.error ? <PortalError message={application.error} retry={application.refetch} /> : currentApplication ? <div className="glass-panel-elevated space-y-3 rounded-[14px] p-5">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={JOB_APPLICATION_STATUS_META[currentApplication.status].variant}>{JOB_APPLICATION_STATUS_META[currentApplication.status].label}</Badge>{currentApplication.caseNumber && <span className="text-[12px] text-[#a6a6a6]">{currentApplication.caseNumber}</span>}</div>
          <p className="text-[13.5px] leading-6 text-[#e5e5e5]">{currentApplication.statusText}</p>
          <p className="text-[12px] text-[#808080]">Aktualisiert: {formatDateTime(currentApplication.updatedAt)}</p>
        </div> : <p className="glass-panel-elevated rounded-[14px] p-5 text-[13px] text-[#a6a6a6]">Du hast noch keine Bewerbung eingereicht.</p>}
        <Link href="/bewerbung" className={primaryAction}>{currentApplication ? 'Bewerbung ansehen' : 'Bewerbung beginnen'}</Link>
      </div>}
    </section>}

    {section === 'presse' && <section className="max-w-3xl">
      {pressId && <Link href="/besucherportal/presse" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-[#a6a6a6] hover:text-white"><ArrowLeft size={14} /> Alle Mitteilungen</Link>}
      {!pressId && <PublicPageTitle title="Pressemitteilungen" description="Aktuelle Veröffentlichungen des Federal Investigation Bureau." />}
      {press.loading && !press.data ? <p role="status" className="text-[13px] text-[#a6a6a6]">Mitteilungen werden geladen …</p> : press.error ? <PortalError message={press.error} retry={press.refetch} /> : pressId ? article ? <article>
        <h1 className="text-[24px] font-semibold tracking-tight text-white">{article.title}</h1>
        <p className="mb-5 mt-2 text-[12px] text-[#808080]">{formatDate(article.publishedAt ?? article.createdAt)}</p>
        {article.imageUrl && <Image unoptimized src={article.imageUrl} alt={article.imageAlt ?? article.title} width={900} height={450} className="mb-5 max-h-80 w-full rounded-[14px] object-cover" />}
        {article.summary && <p className="mb-5 text-[14px] leading-6 text-[#c3c3c3]">{article.summary}</p>}
        <div className="markdown-document glass-panel-elevated rounded-[14px] p-5 sm:p-7" dangerouslySetInnerHTML={{ __html: html }} />
      </article> : <p className="text-[13px] text-[#a6a6a6]">Diese Mitteilung ist nicht verfügbar.</p> : (press.data?.length
        ? <ul className="glass-panel-elevated divide-y divide-[#2c2c2c] overflow-hidden rounded-[14px]">
          {press.data.map(item => <li key={item.id}>
            <Link href={`/besucherportal/presse/${item.id}`} className="block px-5 py-4 hover:bg-[#232323] focus-visible:outline focus-visible:outline-2">
              <p className="text-[12px] text-[#808080]">{formatDate(item.publishedAt ?? item.createdAt)}</p>
              <h2 className="mt-1 text-[14.5px] font-medium text-white">{item.title}</h2>
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-[#a6a6a6]">{item.summary || pressReleaseExcerpt(item.content)}</p>
            </Link>
          </li>)}
        </ul>
        : <p className="glass-panel-elevated rounded-[14px] px-5 py-10 text-center text-[13px] text-[#909090]">Noch keine Mitteilungen veröffentlicht.</p>)}
    </section>}
  </PublicShell>
}

function PortalError({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div role="alert" className="glass-panel-elevated space-y-3 rounded-[14px] p-5"><p className="text-[13px] text-[#fca5a5]">{message}</p><Button size="sm" variant="secondary" onClick={() => void retry()}>Erneut laden</Button></div>
}

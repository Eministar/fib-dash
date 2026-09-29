import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { renderMarkdown } from '@/lib/markdown'
import { readTable } from '@/lib/publications'
import { PublicShell } from '@/components/portal/public-shell'
import { publicationAccess, publicationViewer } from '@/lib/publications-server'
import { PublicTable } from '@/components/publications/public-table'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

// Entwürfe und Archiviertes sind öffentlich nicht erreichbar – auch nicht mit Link.
async function load(slug: string) {
  return prisma.publication.findFirst({ where: { slug, status: 'PUBLISHED' } })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const publication = await load((await params).slug)
  if (!publication) return { title: 'Aushang nicht gefunden' }
  // Geschlossene Aushänge verraten in Link-Vorschauen nichts über ihren Inhalt.
  if (publication.access === 'ROLES') return { title: 'Geschlossener Aushang', robots: { index: false } }
  return { title: publication.title, description: publication.summary ?? undefined }
}

function Gate({ slug, state }: { slug: string; state: 'login' | 'denied' }) {
  return (
    <div className="glass-panel-elevated mx-auto max-w-md rounded-[14px] p-7 text-center">
      <div className="icon-tile mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[12px]"><Lock size={20} /></div>
      <h1 className="text-[18px] font-semibold text-white">{state === 'login' ? 'Geschlossener Aushang' : 'Kein Zugriff'}</h1>
      <p className="mt-2 text-[13px] leading-6 text-[#a6a6a6]">
        {state === 'login'
          ? 'Dieser Aushang ist nur für bestimmte Discord-Rollen freigegeben. Melde dich mit Discord an – danach landest du wieder hier.'
          : 'Deinem Discord-Konto fehlt eine der freigegebenen Rollen. Wende dich an die Person, die dir den Link geschickt hat.'}
      </p>
      {state === 'login' && (
        <a
          href={`/api/auth/discord/login?mode=contract&remember=1&redirect=${encodeURIComponent(`/aushang/${slug}`)}`}
          className="mt-5 inline-flex h-[36px] items-center rounded-[8px] bg-[#d4d4d4] px-4 text-[13px] font-medium text-[#181818] hover:bg-white"
        >
          Mit Discord anmelden
        </a>
      )}
    </div>
  )
}

export default async function PublicNoticePage({ params }: Props) {
  const publication = await load((await params).slug)
  if (!publication) notFound()
  const access = publicationAccess(publication, await publicationViewer())
  if (access !== 'allowed') return <PublicShell active="aushang"><Gate slug={publication.slug} state={access} /></PublicShell>
  const table = publication.kind === 'TABLE' ? readTable(publication.table) : null
  const html = publication.content.trim() ? renderMarkdown(publication.content) : ''

  return (
    <PublicShell active="aushang">
      <Link href="/aushang" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-[#a6a6a6] hover:text-white">
        <ArrowLeft size={14} /> Schwarzes Brett
      </Link>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-[24px] font-semibold tracking-tight text-white">
          {publication.access === 'ROLES' && <Lock size={18} className="shrink-0 text-[#a6a6a6]" aria-label="Geschlossener Aushang" />}
          {publication.title}
        </h1>
        {publication.summary && <p className="mt-2 text-[14px] leading-6 text-[#a6a6a6]">{publication.summary}</p>}
        <p className="mt-2 text-[12px] text-[#808080]">
          Veröffentlicht am {formatDate(publication.publishedAt ?? publication.createdAt)}
          {publication.updatedAt > (publication.publishedAt ?? publication.createdAt) && ` · aktualisiert am ${formatDate(publication.updatedAt)}`}
        </p>
      </header>
      {html && (
        <article
          className={`markdown-document glass-panel-elevated rounded-[14px] p-5 sm:p-7 ${table ? 'mb-6' : ''}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {table && <PublicTable table={table} />}
    </PublicShell>
  )
}

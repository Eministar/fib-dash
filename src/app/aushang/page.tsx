import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, FileText, Lock, Pin, Table2 } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PublicPageTitle, PublicShell } from '@/components/portal/public-shell'
import { formatDate } from '@/lib/utils'
import { publicationAccess, publicationViewer } from '@/lib/publications-server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Schwarzes Brett',
  description: 'Öffentliche Schreiben, Bekanntmachungen und Listen des FIB.',
}

export default async function PublicNoticeBoardPage() {
  const all = await prisma.publication.findMany({
    where: { status: 'PUBLISHED', listed: true },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    select: { slug: true, kind: true, title: true, summary: true, pinned: true, publishedAt: true, updatedAt: true, access: true, roleIds: true },
  })
  // Geschlossene Aushänge nur für Berechtigte aufführen; Discord-Rollen nur abfragen, wenn es welche gibt.
  const viewer = all.some((item) => item.access === 'ROLES') ? await publicationViewer() : null
  const items = all.filter((item) => item.access !== 'ROLES' || (viewer && publicationAccess(item, viewer) === 'allowed'))

  return (
    <PublicShell active="aushang">
      <PublicPageTitle title="Schwarzes Brett" description="Öffentliche Schreiben, Bekanntmachungen und Listen des Federal Investigation Bureau." />
      {items.length === 0
        ? <p className="glass-panel-elevated rounded-[14px] px-5 py-10 text-center text-[13px] text-[#909090]">Derzeit ist nichts ausgehängt.</p>
        : (
          <ul className="glass-panel-elevated divide-y divide-[#2c2c2c] overflow-hidden rounded-[14px]">
            {items.map((item) => {
              const Icon = item.kind === 'TABLE' ? Table2 : FileText
              return (
                <li key={item.slug}>
                  <Link href={`/aushang/${item.slug}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-[#232323] focus-visible:outline focus-visible:outline-2">
                    <Icon size={18} className="shrink-0 text-[#a6a6a6]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-medium text-white">
                        {item.pinned && <Pin size={13} className="shrink-0 text-[#d4d4d4]" aria-label="Angeheftet" />}
                        {item.access === 'ROLES' && <Lock size={13} className="shrink-0 text-[#a6a6a6]" aria-label="Nur für freigegebene Rollen" />}
                        <span className="truncate">{item.title}</span>
                      </span>
                      {item.summary && <span className="mt-0.5 block truncate text-[12.5px] text-[#909090]">{item.summary}</span>}
                    </span>
                    <span className="hidden shrink-0 text-[12px] text-[#808080] sm:block">{formatDate(item.publishedAt ?? item.updatedAt)}</span>
                    <ChevronRight size={16} className="shrink-0 text-[#6f6f6f] group-hover:text-white" aria-hidden />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
    </PublicShell>
  )
}

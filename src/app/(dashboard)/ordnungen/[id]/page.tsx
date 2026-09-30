import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrdnungOutline } from '@/components/ordnungen/ordnung-outline'
import { buildSectionOutline, renderMarkdownDocument } from '@/lib/markdown'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/utils'

async function loadOrdnung(slug: string) {
  try {
    const ordnung = await prisma.ordnung.findUnique({ where: { slug }, include: { category: { select: { label: true } } } })
    if (!ordnung) {
      return { ordnung: null, document: null, error: 'Ordnung nicht gefunden' }
    }
    return { ordnung, document: renderMarkdownDocument(ordnung.content), error: null }
  } catch (error) {
    return {
      ordnung: null,
      document: null,
      error: error instanceof Error ? error.message : 'Fehler beim Laden der Ordnung',
    }
  }
}

const backLink = (
  <Link
    href="/ordnungen"
    className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#2c2c2e] px-3 text-[12.5px] font-medium text-[#f5f5f7] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all duration-150 hover:bg-[#3a3a3c] active:scale-[0.98]"
  >
    <ArrowLeft size={14} strokeWidth={2} />
    Alle Ordnungen
  </Link>
)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ordnung = await prisma.ordnung.findUnique({ where: { slug: (await params).id }, select: { title: true } })
  return { title: ordnung?.title ?? 'Ordnung' }
}

export default async function OrdnungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ordnung, document, error } = await loadOrdnung(id)

  if (error || !ordnung || !document) {
    return (
      <div className="max-w-5xl mx-auto pb-4">
        <PageHeader breadcrumbs={[{ label: 'Ordnungen', href: '/ordnungen' }, { label: 'Fehler' }]} title="Fehler" description="Die angeforderte Ordnung konnte nicht geladen werden" action={backLink} />
        <div className="flex items-start gap-3 p-4 rounded-[12px] bg-[#3a3a3c]/40 border border-[#ff6b6b]/30">
          <AlertCircle size={18} className="text-[#ff6b6b] shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-medium text-[#ff6b6b]">Fehler beim Laden</p>
            <p className="text-[12px] text-[#98989d] mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  const outline = buildSectionOutline(document.headings)

  return (
    <div className="mx-auto max-w-7xl pb-4">
      <PageHeader breadcrumbs={[{ label: 'Ordnungen', href: '/ordnungen' }, { label: ordnung.title }]} title={ordnung.title} description={ordnung.description} />
      <p className="-mt-3 mb-5 text-[12px] text-[#8e8e93]">
        {ordnung.category.label} · {outline.length > 0 ? `${outline.length} Abschnitte · ` : ''}Stand {formatDate(ordnung.updatedAt)}
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <OrdnungOutline entries={outline} variant="inline" />
          <article
            className="markdown-document glass-panel-elevated rounded-[14px] border border-[#38383a]/40 p-5 sm:p-7"
            dangerouslySetInnerHTML={{ __html: document.html }}
          />
        </div>
        <OrdnungOutline entries={outline} variant="sidebar" />
      </div>
    </div>
  )
}

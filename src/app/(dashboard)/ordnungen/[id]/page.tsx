import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { renderMarkdown } from '@/lib/markdown'
import { prisma } from '@/lib/prisma'

async function loadOrdnung(slug: string) {
  try {
    const ordnung = await prisma.ordnung.findUnique({ where: { slug } })
    if (!ordnung) {
      return { config: null, html: null, error: 'Ordnung nicht gefunden' }
    }
    return {
      config: { title: ordnung.title, description: ordnung.description },
      html: renderMarkdown(ordnung.content),
      error: null,
    }
  } catch (error) {
    return {
      config: null,
      html: null,
      error: error instanceof Error ? error.message : 'Fehler beim Laden der Ordnung',
    }
  }
}

export default async function OrdnungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { config, html, error } = await loadOrdnung(id)

  if (error || !config || !html) {
    return (
      <div className="max-w-5xl mx-auto pb-4">
        <PageHeader
          title="Fehler"
          description="Die angeforderte Ordnung konnte nicht geladen werden"
          action={
            <Link
              href="/ordnungen"
              className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#232323] px-3 text-[12.5px] font-medium text-[#f4f4f4] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all duration-150 hover:bg-[#333333] active:scale-[0.98]"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              Zurück
            </Link>
          }
        />
        <div className="flex items-start gap-3 p-4 rounded-[12px] bg-[#282828]/40 border border-[#ff6b6b]/30">
          <AlertCircle size={18} className="text-[#ff6b6b] shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-medium text-[#ff6b6b]">Fehler beim Laden</p>
            <p className="text-[12px] text-[#888] mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto pb-4">
      <PageHeader
        title={config.title}
        description={config.description}
        action={
          <Link
            href="/ordnungen"
            className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#232323] px-3 text-[12.5px] font-medium text-[#f4f4f4] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all duration-150 hover:bg-[#333333] active:scale-[0.98]"
          >
            <ArrowLeft size={14} strokeWidth={2} />
            Zurück
          </Link>
        }
      />

      <article
        className="markdown-document glass-panel-elevated rounded-[14px] border border-[#373737]/40 p-5 sm:p-7"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}


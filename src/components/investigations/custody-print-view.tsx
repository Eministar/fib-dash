'use client'

import Image from 'next/image'
import { FileDown } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageLoader } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, type EvidenceKindKey, type EvidenceStatusKey } from '@/lib/investigations'
import type { CustodyReport } from '@/lib/custody'
import { formatDateTime } from '@/lib/utils'
import { CustodyEventRow, CustodyIntegrityBadge } from '@/components/investigations/evidence-custody'

/**
 * Beweiskette als amtlicher Auszug. „Als PDF speichern“ öffnet den
 * Druckdialog – derselbe Weg wie bei der Personalakte, ohne PDF-Bibliothek.
 */
export function CustodyPrintView({ evidenceId }: { evidenceId: string }) {
  const { user } = useAuth()
  const canView = hasPermission(user, 'investigations:view')
  const { data: report, loading, error } = useFetch<CustodyReport>(
    canView ? `/api/investigations/evidence/${evidenceId}/custody?log=1` : null,
  )

  if (!canView) return <UnauthorizedContent />
  if (loading && !report) return <PageLoader withHeader />
  if (!report) {
    return (
      <Card className="py-14 text-center">
        <p className="text-[13.5px] text-[#98989d]">{error || 'Asservat nicht gefunden.'}</p>
      </Card>
    )
  }

  const { evidence } = report
  const exportPdf = () => {
    // Der Dokumenttitel wird im Druckdialog als Dateiname vorgeschlagen.
    const previousTitle = document.title
    document.title = `Beweiskette ${evidence.itemNumber} (${evidence.investigation.caseNumber})`
    const restore = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const facts: [string, string][] = [
    ['Asservat', `${evidence.itemNumber} · ${evidence.title}`],
    ['Akte', `${evidence.investigation.caseNumber} · ${evidence.investigation.title}`],
    ['Art', EVIDENCE_KIND_LABELS[evidence.kind as EvidenceKindKey] ?? evidence.kind],
    ['Status', EVIDENCE_STATUS_LABELS[evidence.status as EvidenceStatusKey] ?? evidence.status],
    ['Sichergestellt', [evidence.seizedAt && formatDateTime(evidence.seizedAt), evidence.seizedLocation].filter(Boolean).join(' · ') || '—'],
    ['Verwahrort', evidence.storageLocation ?? '—'],
    ['Aktueller Verwahrer', report.currentHolder ?? '—'],
    ['Integrität', report.integrity.valid ? `lückenlos (${report.events.length} Einträge)` : 'BESCHÄDIGT – nachträglich verändert'],
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <PageHeader
          breadcrumbs={[
            { label: 'Einsatzakten', href: '/investigations' },
            { label: evidence.investigation.caseNumber, href: `/investigations/${evidence.investigation.id}?tab=asservate` },
            { label: `Beweiskette ${evidence.itemNumber}` },
          ]}
          title={`Beweiskette ${evidence.itemNumber}`}
          description={evidence.title}
          action={
            <Button onClick={exportPdf}>
              <FileDown className="h-4 w-4" />
              Als PDF speichern
            </Button>
          }
        />
        <div className="mb-4">
          <CustodyIntegrityBadge report={report} />
        </div>
      </div>

      <div className="timeline-print">
        <header className="hidden print:block">
          <div className="timeline-print-rule flex items-center gap-4 border-b pb-4">
            <Image src="/shield.webp" alt="" width={56} height={56} className="rounded-full" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">Federal Investigation Bureau</p>
              <h1 className="text-[22px] font-semibold">Beweiskette · {evidence.itemNumber}</h1>
            </div>
          </div>
        </header>

        <dl className="timeline-print-rule mb-5 grid gap-x-8 gap-y-2 border-b border-[#2c2c2e] pb-4 pt-4 text-[12.5px] sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="timeline-print-muted text-[#8e8e93]">{label}</dt>
              <dd className="font-medium text-white">{value}</dd>
            </div>
          ))}
        </dl>

        <ol className="timeline-list rounded-[10px] border border-[#2c2c2e] px-3">
          {report.events.map((event) => (
            <CustodyEventRow key={event.id} event={event} broken={event.id === report.integrity.brokenAtId} />
          ))}
        </ol>

        <p className="timeline-print-muted mt-4 text-[11px] text-[#8e8e93]">
          Erstellt am {formatDateTime(new Date())}
          {user?.displayName ? ` von ${user.displayName}` : ''}. Jeder Eintrag enthält den SHA-256-Hash seines Vorgängers;
          nachträgliche Änderungen in der Datenbank lassen die Integritätsprüfung fehlschlagen.
        </p>
      </div>
    </div>
  )
}

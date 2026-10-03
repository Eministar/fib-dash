'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Link2, Plus, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Breadcrumbs } from '@/components/layout/breadcrumbs'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageLoader } from '@/components/ui/loading'
import { LspdOfficerFilePanel } from '@/components/lspd/lspd-officer-file'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { useTrackRecentItem } from '@/hooks/use-recent-items'
import { officialNumber } from '@/lib/corruption-validation'
import { lspdOfficerName, type LspdOfficerFile } from '@/lib/lspd-officers'
import { hasPermission } from '@/lib/permissions'
import { formatDateTime } from '@/lib/utils'
import { BalanceChips, GradeBadge, RatingBadge, type QcCheck } from './qc-shared'
import { ShareDialog, StartCheckDialog } from './qc-dialogs'

type OfficerQuality = {
  checks: QcCheck[]
  corruption: { officialId: number; checks: { id: string; conductedAt: string; result: string }[] } | null
}

/** Beamtenakte: LSPD-Daten live aus dem Panel, dazu alle Qualitäts- und Korruptionskontrollen. */
export function QualityOfficerFile({ lspdOfficerId }: { lspdOfficerId: string }) {
  const { user } = useAuth()
  const canView = hasPermission(user, 'quality-checks:view')
  const canManage = hasPermission(user, 'quality-checks:manage')
  const { data, loading, error } = useFetch<OfficerQuality>(canView ? `/api/quality-checks/officers/${lspdOfficerId}` : null)
  const lspd = useFetch<LspdOfficerFile>(canView ? `/api/lspd/officers/${lspdOfficerId}` : null)
  const [startOpen, setStartOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const officerName = lspd.data ? lspdOfficerName(lspd.data) : data?.checks[0]?.officerName
  useTrackRecentItem(officerName ? { href: `/quality-checks/officers/${lspdOfficerId}`, title: officerName, kind: 'lspd-officer' } : null)

  if (!canView) return <UnauthorizedContent />
  if (loading && !data) return <PageLoader withHeader />

  const latest = data?.checks[0]
  const name = lspd.data ? lspdOfficerName(lspd.data) : latest?.officerName ?? 'LSPD-Beamter'
  const hasChecks = Boolean(data?.checks.length)

  return (
    <div className="mx-auto max-w-4xl pb-6">
      <Breadcrumbs className="mb-4" items={[{ label: 'Qualitätskontrollen', href: '/quality-checks' }, { label: name }]} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-white">{name}</h1>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {hasChecks && (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Link2 className="h-4 w-4" />
                Akte freigeben
              </Button>
            )}
            <Button onClick={() => setStartOpen(true)} disabled={!lspd.data}>
              <Plus className="h-4 w-4" />
              Kontrolle beginnen
            </Button>
          </div>
        )}
      </div>

      <LspdOfficerFilePanel officerId={lspdOfficerId} file={lspd.data} />

      <Card className="mb-4">
        <h2 className="mb-3 text-[14px] font-semibold text-white">Qualitätskontrollen ({data?.checks.length ?? 0})</h2>
        {error && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{error}</p>}
        {!data?.checks.length ? (
          <p className="py-3 text-[12.5px] text-[#8e8e93]">Noch keine Qualitätskontrolle zu diesem Beamten.</p>
        ) : (
          <ul className="divide-y divide-[#2c2c2e]">
            {data.checks.map((check) => (
              <li key={check.id}>
                <Link href={`/quality-checks/${check.id}`} className="-mx-2 flex items-center gap-3 rounded-[8px] px-2 py-2.5 hover:bg-[#1c1c1e]">
                  <span className="w-[64px] shrink-0 font-mono text-[11.5px] text-[#d4af37]">{check.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-white">{formatDateTime(check.startedAt)}{check.location ? ` · ${check.location}` : ''}</span>
                    {check.summary && <span className="block truncate text-[12px] text-[#98989d]">{check.summary}</span>}
                  </span>
                  <BalanceChips entries={check.entries} />
                  <GradeBadge grade={check.grade} />
                  <RatingBadge rating={check.rating} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#636366]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-semibold text-white">Korruptionskontrollen</h2>
        {!data?.corruption ? (
          <p className="text-[12.5px] text-[#8e8e93]">Keine verknüpfte Beamtenakte bei den Korruptionskontrollen.</p>
        ) : (
          <>
            <Link href={`/corruption-checks?official=${data.corruption.officialId}`} className="text-[12.5px] text-[#c4b5fd] hover:underline">
              Akte {officialNumber(data.corruption.officialId)} öffnen →
            </Link>
            <ul className="mt-2 space-y-1">
              {data.corruption.checks.map((check) => (
                <li key={check.id} className="flex items-center gap-2 text-[12.5px] text-[#e5e5ea]">
                  {check.result === 'FINDINGS' ? (
                    <ShieldAlert className="h-3.5 w-3.5 text-[#ffd60a]" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 text-[#30d158]" />
                  )}
                  {formatDateTime(check.conductedAt)} · {check.result === 'FINDINGS' ? 'Mit Befund' : 'Ohne Befund'}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {startOpen && lspd.data && <StartCheckDialog open onClose={() => setStartOpen(false)} initialOfficer={lspd.data} />}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        scope="OFFICER"
        lspdOfficerId={lspdOfficerId}
        defaultTitle={`Beamtenakte ${name}`}
      />
    </div>
  )
}

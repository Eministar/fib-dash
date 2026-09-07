'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, CheckCircle2, ChevronRight, Clipboard } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useFetch } from '@/hooks/use-fetch'
import { formatDateTime } from '@/lib/utils'
import {
  KIND_META,
  QuestionAnalytics,
  STATUS_META,
  StatCard,
  modulePath,
  responseScore,
  type FormResponse,
  type FormTestMeta,
} from '@/components/modules/form-test-shared'

interface ResponsesPayload {
  test: FormTestMeta
  responses: FormResponse[]
}

export function FormTestResponses({ testId }: { testId: string }) {
  const { data, loading, error: loadError } = useFetch<ResponsesPayload>(testId ? `/api/form-tests/${testId}/responses` : null)

  const responses = useMemo(() => data?.responses ?? [], [data?.responses])

  const stats = useMemo(() => {
    const scored = responses.filter((response) => response.maxScore > 0 && response.score !== null)
    const average = scored.length > 0
      ? Math.round(scored.reduce((sum, response) => sum + (response.score ?? 0), 0) / scored.length)
      : null
    return {
      total: responses.length,
      reviewed: responses.filter((response) => response.reviewedAt).length,
      average,
    }
  }, [responses])

  if (loading) return <PageLoader />

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Abgaben" description="Die Auswertung konnte nicht geladen werden." eyebrow="Auswertung" />
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-14 text-center">
          <Clipboard size={26} className="mx-auto mb-2 text-[#808080]" />
          <p className="text-[13px] text-[#a6a6a6]">{loadError ?? 'Auswertung nicht verfügbar'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={data.test.title}
        description={data.test.kind === 'SURVEY'
          ? 'Abgaben und Auswertung dieser Umfrage.'
          : 'Abgaben, Punkte und Bewertungsnotizen dieses Tests.'}
        eyebrow={data.test.kind === 'SURVEY' ? 'Umfrage-Auswertung' : 'Test-Auswertung'}
        action={(
          <Link href={modulePath(data.test.module)}>
            <Button variant="secondary" size="sm">
              <ArrowLeft size={13} />
              Zurück
            </Button>
          </Link>
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant={KIND_META[data.test.kind].variant}>{KIND_META[data.test.kind].label}</Badge>
        <Badge variant={STATUS_META[data.test.status].variant}>{STATUS_META[data.test.status].label}</Badge>
        {data.test.kind === 'SURVEY' && data.test.anonymousResponses && <Badge variant="info">Anonym</Badge>}
      </div>

      {responses.length === 0 ? (
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-14 text-center">
          <Clipboard size={26} className="mx-auto mb-2 text-[#808080]" />
          <p className="text-[13px] text-[#a6a6a6]">Noch keine Abgaben vorhanden</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard label="Abgaben" value={stats.total} icon={<Clipboard size={16} />} />
            <StatCard label="Bewertet" value={stats.reviewed} icon={<CheckCircle2 size={16} />} />
            <StatCard label="Ø Punkte" value={stats.average ?? 0} icon={<BarChart3 size={16} />} />
          </div>

          <QuestionAnalytics questions={data.test.questions} responses={responses} />

          <section className="glass-panel-elevated overflow-hidden rounded-[14px] border border-[#373737]/45">
            <div className="border-b border-[#343434]/45 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a6a6a6]">Abgaben</p>
            </div>
            <div className="divide-y divide-[#343434]/35">
              {responses.map((response) => (
                <Link
                  key={response.id}
                  href={`/form-tests/manage/${testId}/responses/${response.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#232323]/55"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-white">
                      {response.respondent?.displayName ?? response.respondentName}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-[#909090]">Abgegeben {formatDateTime(response.submittedAt)}</p>
                  </div>
                  <Badge variant={response.reviewedAt ? 'success' : 'default'}>{responseScore(response)}</Badge>
                  <Badge variant={response.reviewedAt ? 'success' : 'warning'}>
                    {response.reviewedAt ? 'Bewertet' : 'Offen'}
                  </Badge>
                  <span className="flex items-center gap-1 text-[12px] font-medium text-[#d4d4d4]">
                    Öffnen
                    <ChevronRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

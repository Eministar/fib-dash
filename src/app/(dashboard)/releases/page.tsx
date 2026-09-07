'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  GitCommit,
  History,
  RefreshCw,
  Tag,
} from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { useFetch } from '@/hooks/use-fetch'
import type { CommitHistoryResponse, CommitLegendEntry } from '@/lib/release-history'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unbekanntes Datum'
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function CommitRow({ entry, current }: { entry: CommitLegendEntry; current: boolean }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-[13px] border px-4 py-3.5 transition-colors ${
        current
          ? 'border-[#d4d4d4]/35 bg-[#d4d4d4]/[0.07]'
          : 'border-[#343434]/65 bg-[#181818]/75 hover:border-[#494949]'
      }`}
    >
      {current && <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[#d4d4d4]" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#484848] bg-[#242424] px-2 py-1 font-mono text-[10px] font-semibold text-[#e3c967]">
              <Tag size={11} />
              {entry.buildId}
            </span>
            {current && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[#34d399]/[0.1] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#6ee7b7]">
                <CheckCircle2 size={11} /> Aktueller Build
              </span>
            )}
          </div>
          <h2 className="mt-2 text-[13px] font-semibold leading-5 text-[#f4f4f4]">{entry.subject}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[#858585]">
            <span className="inline-flex items-center gap-1.5">
              <GitCommit size={12} className="text-[#757575]" />
              <span className="font-mono text-[#adadad]">{entry.shortCommit}</span>
            </span>
            <span>{entry.author}</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 size={11} /> {formatDate(entry.date)}
            </span>
          </div>
        </div>
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-[8px] border border-[#404040] px-2.5 py-1.5 text-[10px] font-semibold text-[#a5a5a5] transition-colors hover:border-[#d4d4d4]/40 hover:text-[#c3c3c3]"
        >
          <ExternalLink size={11} /> GitHub
        </a>
      </div>
    </motion.article>
  )
}

export default function ReleasesPage() {
  const { data, loading, error, refetch } = useFetch<CommitHistoryResponse>('/api/releases/commits')
  const currentCommit = useMemo(() => {
    if (!data) return null
    return data.entries.find(
      (entry) => entry.commit === data.currentBuildId || entry.buildId === `build-${data.currentBuildId.slice(0, 10)}`,
    )
  }, [data])

  return (
    <div>
      <PageHeader
        eyebrow="Transparenz"
        title="Build-Historie"
        description="Jeder ausgelieferte Commit hat eine feste Build-ID. So lässt sich jederzeit nachvollziehen, welche Version gerade läuft."
        action={
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#404040] bg-[#1e1e1e] px-3 text-[11px] font-semibold text-[#bcbcbc] transition-colors hover:border-[#d4d4d4]/40 hover:text-[#c3c3c3]"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Aktualisieren
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-[11px] border border-[#f87171]/25 bg-[#f87171]/[0.06] px-4 py-3 text-[11px] text-[#fca5a5]">
          Die Build-Historie konnte nicht geladen werden: {error}
        </div>
      )}

      <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
        <div className="relative overflow-hidden rounded-[16px] border border-[#d4d4d4]/25 bg-[radial-gradient(circle_at_top_right,rgba(212,212,212,0.13),transparent_50%),#1b1b1b] p-5 sm:p-6">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-[#d4d4d4]/10" />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#d4d4d4]/80">Aktuell ausgeliefert</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-[10px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/[0.1] px-3 py-2 font-mono text-[14px] font-semibold text-[#f0d776]">
                <GitCommit size={16} /> {data?.currentBuildShort ?? 'build-…'}
              </span>
              <span className="text-[11px] text-[#9d9d9d]">App-Version {data?.appVersion ?? '1.1.3'}</span>
            </div>
            <p className="mt-3 max-w-xl text-[11.5px] leading-5 text-[#a5a5a5]">
              {currentCommit?.subject ?? 'Die aktuelle Commit-Zuordnung wird gerade aus GitHub geladen.'}
            </p>
            {currentCommit && (
              <p className="mt-2 text-[10px] text-[#787878]">
                Commit <span className="font-mono text-[#adadad]">{currentCommit.commit}</span> · {currentCommit.author}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[16px] border border-[#343434]/70 bg-[#1b1b1b]/70 p-5">
          <div className="flex items-center gap-2 text-[#e2e2e2]">
            <History size={16} className="text-[#d4d4d4]" />
            <h2 className="text-[12px] font-semibold">Commit-Verzeichnis</h2>
          </div>
          <dl className="mt-4 space-y-3 text-[10.5px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#7e7e7e]">Repository</dt>
              <dd className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[#bcbcbc]">
                <GitBranch size={12} /> {data?.repository ?? 'FIB Dashboard'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#7e7e7e]">Zuordnungen</dt>
              <dd className="font-semibold tabular-nums text-[#e2e2e2]">{data?.entries.length ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#7e7e7e]">Quelle</dt>
              <dd className="text-[#6ee7b7]">{data?.source === 'snapshot' ? 'Gespeicherter Snapshot' : 'GitHub live'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#7e7e7e]">Letzte Sync</dt>
              <dd className="text-right text-[#bcbcbc]">{data ? formatDate(data.generatedAt) : '—'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-[#f4f4f4]">Alle Commits</h2>
            <p className="mt-1 text-[10.5px] text-[#797979]">Automatisch aus dem öffentlichen GitHub-Verlauf synchronisiert.</p>
          </div>
          <span className="rounded-md bg-[#242424] px-2 py-1 font-mono text-[9px] text-[#8c8c8c]">ID = build + SHA</span>
        </div>

        {loading && !data ? (
          <div className="space-y-2">
            {[0, 1, 2].map((item) => <div key={item} className="h-[92px] animate-pulse rounded-[13px] border border-[#343434]/50 bg-[#1b1b1b]/55" />)}
          </div>
        ) : data?.entries.length ? (
          <div className="space-y-2.5">
            {data.entries.map((entry) => (
              <CommitRow
                key={entry.commit}
                entry={entry}
                current={entry.commit === data.currentBuildId || entry.buildId === `build-${data.currentBuildId.slice(0, 10)}`}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[12px] border border-dashed border-[#414141] px-4 py-10 text-center text-[11px] text-[#858585]">
            Noch keine Commit-Daten vorhanden.
          </div>
        )}
      </section>
    </div>
  )
}

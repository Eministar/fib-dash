'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ClipboardCheck, Copy, Link2, Plus, RefreshCw } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/filter-bar'
import { ListSkeleton } from '@/components/ui/loading'
import { TabBar, resolveTab, type TabItem } from '@/components/ui/tab-bar'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFetch } from '@/hooks/use-fetch'
import { useUrlState } from '@/hooks/use-url-state'
import { lspdOfficerName, lspdStatusLabel, type LspdOfficer } from '@/lib/lspd-officers'
import { hasPermission } from '@/lib/permissions'
import { QC_SHARE_SCOPE_LABELS, type QcOfficerStats, type QcShareScope } from '@/lib/quality-checks'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { BalanceChips, RatingBadge, type QcCheck } from './qc-shared'
import { ShareDialog, StartCheckDialog } from './qc-dialogs'

type CheckList = { items: (Omit<QcCheck, 'entries'> & { entries: QcCheck['entries'] })[]; total: number; page: number; pageSize: number }

const TABS = ['beamte', 'kontrollen', 'freigaben'] as const

export function QualityChecksWorkspace() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'quality-checks:view')
  const canManage = hasPermission(user, 'quality-checks:manage')
  const [tab, setTab] = useUrlState('tab', 'beamte', TABS)
  const [startOpen, setStartOpen] = useState(false)

  if (!canView) return <UnauthorizedContent />

  const tabs: TabItem[] = [
    { id: 'beamte', label: 'Beamtenakten' },
    { id: 'kontrollen', label: 'Kontrollen' },
    ...(canManage ? [{ id: 'freigaben', label: 'Freigabelinks' }] : []),
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Ermittlungen & Disziplin"
        title="Qualitätskontrollen"
        description="Verdeckte Mitfahrten bei LSPD-Beamten: unterwegs protokollieren, abschließen, bei Bedarf per Link freigeben."
        action={
          canManage ? (
            <Button onClick={() => setStartOpen(true)}>
              <Plus className="h-4 w-4" />
              Kontrolle beginnen
            </Button>
          ) : null
        }
      />
      <TabBar tabs={tabs} active={resolveTab(tab, tabs)} onSelect={(id) => setTab(id as (typeof TABS)[number])} label="Bereiche" />

      {resolveTab(tab, tabs) === 'beamte' && <OfficersTab />}
      {resolveTab(tab, tabs) === 'kontrollen' && <ChecksTab />}
      {resolveTab(tab, tabs) === 'freigaben' && canManage && <SharesTab />}

      <StartCheckDialog open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  )
}

/**
 * Alle LSPD-Beamten aus dem Panel, ergänzt um die Kennzahlen der Kontrollen.
 * Ist das Panel nicht erreichbar, bleiben wenigstens die bereits kontrollierten Beamten sichtbar.
 */
function OfficersTab() {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 250)
  const lspd = useFetch<LspdOfficer[]>(`/api/lspd/officers?limit=100&q=${encodeURIComponent(debounced)}`)
  const stats = useFetch<QcOfficerStats[]>('/api/quality-checks/officers')
  const statsById = useMemo(() => new Map((stats.data ?? []).map((row) => [row.lspdOfficerId, row])), [stats.data])

  const rows = useMemo(() => {
    if (lspd.data) {
      return lspd.data.map((officer) => ({
        id: officer.id,
        name: lspdOfficerName(officer),
        badge: officer.badgeNumber,
        rank: officer.rank.name,
        rankColor: officer.rank.color,
        status: lspdStatusLabel(officer.status),
        stats: statsById.get(officer.id) ?? null,
      }))
    }
    const term = debounced.toLowerCase()
    return (stats.data ?? [])
      .filter((row) => !term || `${row.name} ${row.badgeNumber}`.toLowerCase().includes(term))
      .map((row) => ({ id: row.lspdOfficerId, name: row.name, badge: row.badgeNumber, rank: row.rank, rankColor: '#8e8e93', status: '', stats: row }))
  }, [debounced, lspd.data, stats.data, statsById])

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Beamten nach Name oder Dienstnummer suchen …" />
      {lspd.error && (
        <p role="status" className="rounded-[10px] border border-[#ff9f0a]/40 bg-[#ff9f0a]/10 px-3 py-2 text-[12.5px] text-[#ffd60a]">
          {lspd.error} Angezeigt werden nur bereits kontrollierte Beamte.
        </p>
      )}
      {(lspd.loading && !lspd.data && !lspd.error) || (stats.loading && !stats.data) ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Kein Beamter gefunden" />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-[#2c2c2e]">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/quality-checks/officers/${row.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#1c1c1e]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.rankColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono text-[11.5px] text-[#d4d4d4]">{row.badge}</span>
                      <span className="truncate text-[13.5px] font-medium text-white">{row.name}</span>
                    </span>
                    <span className="block text-[12px] text-[#8e8e93]">
                      {row.rank}
                      {row.status ? ` · ${row.status}` : ''}
                    </span>
                  </span>
                  {row.stats ? (
                    <span className="hidden shrink-0 text-right text-[11.5px] text-[#98989d] sm:block">
                      {row.stats.total} Kontrollen · zuletzt {formatDate(row.stats.lastCheckAt)}
                      <span className="mt-0.5 flex justify-end gap-2 font-mono">
                        <span className="text-[#30d158]">{row.stats.ratings.POSITIVE}↑</span>
                        <span className="text-[#d4d4d4]">{row.stats.ratings.NEUTRAL}→</span>
                        <span className="text-[#ff453a]">{row.stats.ratings.NEGATIVE}↓</span>
                        {row.stats.running > 0 && <span className="text-[#64d2ff]">{row.stats.running} läuft</span>}
                      </span>
                    </span>
                  ) : (
                    <span className="hidden shrink-0 text-[11.5px] text-[#636366] sm:block">noch nicht kontrolliert</span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#636366]" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function ChecksTab() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'RUNNING' | 'COMPLETED'>('')
  const [page, setPage] = useState(1)
  const debounced = useDebouncedValue(search.trim(), 250)
  const { data, loading, error } = useFetch<CheckList>(
    `/api/quality-checks?page=${page}&q=${encodeURIComponent(debounced)}${status ? `&status=${status}` : ''}`,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[220px] flex-1">
          <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder="Nummer, Beamter, Dienstnummer, Ort …" />
        </div>
        {([['', 'Alle'], ['RUNNING', 'Laufend'], ['COMPLETED', 'Abgeschlossen']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { setStatus(value); setPage(1) }}
            className={cn('rounded-full border px-3 text-[12.5px]', status === value ? 'border-[#d4d4d4] text-white' : 'border-[#38383a] text-[#8e8e93]')}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{error}</p>}
      {loading && !data ? (
        <ListSkeleton />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Keine Kontrollen" />
      ) : (
        <>
          <Card className="p-0">
            <ul className="divide-y divide-[#2c2c2e]">
              {data.items.map((check) => (
                <li key={check.id}>
                  <Link href={`/quality-checks/${check.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#1c1c1e]">
                    <span className="w-[64px] shrink-0 font-mono text-[11.5px] text-[#d4af37]">{check.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-white">{check.officerName}</span>
                      <span className="block truncate text-[12px] text-[#8e8e93]">
                        DN {check.officerBadge} · {formatDateTime(check.startedAt)}
                        {check.location ? ` · ${check.location}` : ''} · {check.conductorName}
                      </span>
                    </span>
                    <BalanceChips entries={check.entries} />
                    <RatingBadge rating={check.rating} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {data.total > data.pageSize && (
            <div className="flex items-center justify-between text-[12px] text-[#8e8e93]">
              <span>{data.total} Kontrollen · Seite {data.page} von {Math.ceil(data.total / data.pageSize)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</Button>
                <Button size="sm" variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Weiter</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type ShareRow = {
  id: string
  title: string
  scope: QcShareScope
  enabled: boolean
  includeCareer: boolean
  expiresAt: string | null
  lastAccessAt: string | null
  createdAt: string
  createdBy: { displayName: string } | null
}

function SharesTab() {
  const { addToast } = useToast()
  const { data, loading, refetch } = useFetch<ShareRow[]>('/api/quality-checks/shares')
  const { execute } = useApi<{ path: string | null }>()
  const [allOpen, setAllOpen] = useState(false)
  const [freshLink, setFreshLink] = useState<string | null>(null)
  // Stichtag für „abgelaufen“ – einmal beim Öffnen, nicht bei jedem Render.
  const [now] = useState(() => Date.now())

  const update = async (id: string, body: Record<string, unknown>) => {
    try {
      const result = await execute(`/api/quality-checks/shares/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (result?.path) setFreshLink(`${window.location.origin}${result.path}`)
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Änderung fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-[#98989d]">
          Links für eine Kontrolle oder eine Beamtenakte erstellst du direkt dort. Hier geht auch ein Link für alle Beamtenakten.
        </p>
        <Button variant="outline" onClick={() => setAllOpen(true)}>
          <Link2 className="h-4 w-4" />
          Link für alle Beamtenakten
        </Button>
      </div>

      {freshLink && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#30d158]/40 bg-[#30d158]/10 p-3">
          <span className="text-[12.5px] text-[#30d158]">Neuer Link (nur jetzt sichtbar, der alte ist ungültig):</span>
          <code className="min-w-0 flex-1 truncate text-[12px] text-white">{freshLink}</code>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(freshLink).then(() => addToast({ type: 'success', title: 'Link kopiert' }))}>
            <Copy className="h-3.5 w-3.5" />
            Kopieren
          </Button>
        </div>
      )}

      {loading && !data ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <EmptyState icon={Link2} title="Noch keine Freigabelinks" />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-[#2c2c2e]">
            {data.map((share) => {
              const expired = share.expiresAt && new Date(share.expiresAt).getTime() <= now
              return (
                <li key={share.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-white">{share.title}</span>
                    <span className="block text-[12px] text-[#8e8e93]">
                      {QC_SHARE_SCOPE_LABELS[share.scope]}
                      {share.includeCareer ? ' · mit LSPD-Laufbahn' : ''}
                      {share.expiresAt ? ` · gültig bis ${formatDateTime(share.expiresAt)}` : ' · unbefristet'}
                      {share.lastAccessAt ? ` · zuletzt geöffnet ${formatDateTime(share.lastAccessAt)}` : ' · noch nie geöffnet'}
                      {share.createdBy ? ` · ${share.createdBy.displayName}` : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11.5px]',
                      share.enabled && !expired ? 'bg-[#30d158]/15 text-[#30d158]' : 'bg-[#8e8e93]/20 text-[#98989d]',
                    )}
                  >
                    {!share.enabled ? 'deaktiviert' : expired ? 'abgelaufen' : 'aktiv'}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void update(share.id, { enabled: !share.enabled })}>
                    {share.enabled ? 'Deaktivieren' : 'Aktivieren'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void update(share.id, { rotate: true })} title="Neuen Link erzeugen, der alte wird ungültig">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Link ersetzen
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <ShareDialog
        open={allOpen}
        onClose={() => setAllOpen(false)}
        scope="ALL"
        defaultTitle="Alle Beamtenakten – Qualitätskontrollen"
        onCreated={() => void refetch()}
      />
    </div>
  )
}

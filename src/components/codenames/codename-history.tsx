'use client'

import { displayBadgeNumber } from '@/lib/agents/badge-number'

import { useState } from 'react'
import Link from 'next/link'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import { ListSkeleton } from '@/components/ui/loading'

type HistoryData = {
  current?: { name: string } | null
  prefix?: string
  total: number
  items: { id: string; assignedAt: string; releasedAt: string | null; releaseReason: string | null; note: string | null; agent?: { firstName: string; lastName: string; badgeNumber: string }; codename?: { name: string }; assignedBy: { displayName: string } | null; releasedBy: { displayName: string } | null }[]
}
const reasons: Record<string, string> = { MANUAL: 'Manuell freigegeben', REASSIGNED: 'Neu zugewiesen', TERMINATED: 'Agent gekündigt', RETIRED: 'Deckname gesperrt' }

export function CodenameHistory({ agentId, codenameId }: { agentId?: string; codenameId?: string }) {
  const [page, setPage] = useState(1)
  const url = agentId ? `/api/agents/${agentId}/codename` : `/api/codenames/${codenameId}/history`
  const { data, error, loading } = useFetch<HistoryData>(`${url}?page=${page}&pageSize=10`)
  const history = <>
    {loading ? <ListSkeleton compact /> : data?.items.length === 0 ? <p className="text-sm text-[#8e8e93]">Noch keine Zuweisungen.</p> : <ol className="space-y-3">
      {data?.items.map(item => <li key={item.id} className="border-l-2 border-[#48484a] pl-3 text-sm">
        <p className="font-medium text-white">{item.codename ? [data.prefix, item.codename.name].filter(Boolean).join(' ') : item.agent ? `${item.agent.firstName} ${item.agent.lastName} · ${displayBadgeNumber(item.agent.badgeNumber)}` : 'Agent entfernt'}</p>
        <p className="text-[#98989d]">{formatDateTime(item.assignedAt)} – {item.releasedAt ? formatDateTime(item.releasedAt) : 'aktuell'}</p>
        <p className="text-xs text-[#8e8e93]">Zugewiesen von {item.assignedBy?.displayName ?? 'gelöschtem Benutzer'}{item.releaseReason && ` · ${reasons[item.releaseReason] ?? item.releaseReason} (${item.releasedBy?.displayName ?? 'gelöschter Benutzer'})`}</p>
        {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-[#98989d]">{item.note}</p>}
      </li>)}
    </ol>}
    {!!data && data.total > 10 && <div className="flex items-center gap-3"><Button size="sm" variant="ghost" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button><span className="text-xs text-[#8e8e93]">{page} / {Math.ceil(data.total / 10)}</span><Button size="sm" variant="ghost" disabled={page * 10 >= data.total || loading} onClick={() => setPage(page + 1)}>Weiter</Button></div>}
  </>
  return <section className="space-y-3">
    {agentId && <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[13.5px] font-semibold text-[#eee]">Deckname</h2>
        <p className="text-[13px] text-[#b5b5ba]">{data ? data.current ? [data.prefix, data.current.name].filter(Boolean).join(' ') : 'Kein Deckname zugewiesen' : 'Wird geladen …'}</p>
      </div>
      <Link href="/codenames" className="rounded px-2 py-1.5 text-[12.5px] text-[#98989d] transition-colors hover:bg-[#2c2c2e] hover:text-white">Katalog öffnen</Link>
    </div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {agentId ? <details className="group">
      <summary className="w-fit cursor-pointer rounded py-1 text-[12.5px] text-[#98989d] hover:text-white">Zuweisungsverlauf{data ? ` (${data.total})` : ''}</summary>
      <div className="mt-3">{history}</div>
    </details> : history}
  </section>
}

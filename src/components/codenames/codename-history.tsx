'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

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
  return <section className="space-y-4">
    {agentId && <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Deckname</h2><p className="mt-1 text-sm text-[#a6a6a6]">{data ? data.current ? [data.prefix, data.current.name].filter(Boolean).join(' ') : 'Kein Deckname zugewiesen' : 'Wird geladen …'}</p></div><Link href="/codenames"><Button variant="outline" size="sm">Katalog öffnen</Button></Link></div>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-sm text-[#909090]">Historie wird geladen …</p> : data?.items.length === 0 ? <p className="text-sm text-[#909090]">Noch keine Zuweisungen.</p> : <ol className="space-y-3">
      {data?.items.map(item => <li key={item.id} className="border-l-2 border-[#404040] pl-3 text-sm">
        <p className="font-medium text-white">{item.codename ? [data.prefix, item.codename.name].filter(Boolean).join(' ') : item.agent ? `${item.agent.firstName} ${item.agent.lastName} · ${item.agent.badgeNumber}` : 'Agent entfernt'}</p>
        <p className="text-[#a6a6a6]">{formatDateTime(item.assignedAt)} – {item.releasedAt ? formatDateTime(item.releasedAt) : 'aktuell'}</p>
        <p className="text-xs text-[#909090]">Zugewiesen von {item.assignedBy?.displayName ?? 'gelöschtem Benutzer'}{item.releaseReason && ` · ${reasons[item.releaseReason] ?? item.releaseReason} (${item.releasedBy?.displayName ?? 'gelöschter Benutzer'})`}</p>
        {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-[#a6a6a6]">{item.note}</p>}
      </li>)}
    </ol>}
    {!!data && data.total > 10 && <div className="flex items-center gap-3"><Button size="sm" variant="ghost" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button><span className="text-xs text-[#909090]">{page} / {Math.ceil(data.total / 10)}</span><Button size="sm" variant="ghost" disabled={page * 10 >= data.total || loading} onClick={() => setPage(page + 1)}>Weiter</Button></div>}
  </section>
}

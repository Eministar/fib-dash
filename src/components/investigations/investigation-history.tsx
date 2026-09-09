'use client'

import { History } from 'lucide-react'

import { SectionCard } from '@/components/ui/section-card'
import { useFetch } from '@/hooks/use-fetch'
import { formatDateTime } from '@/lib/utils'

type HistoryEntry = {
  id: string
  action: string
  details: string | null
  createdAt: string
  userName: string
}

/**
 * Wer wann was an dieser Akte geändert hat. Bei Verschlusssachen ist
 * Nachvollziehbarkeit kein Luxus – die Daten lagen im Prüfprotokoll schon,
 * wurden in der Akte aber nirgends gezeigt.
 */
export function InvestigationHistory({ investigationId }: { investigationId: string }) {
  const { data, loading, error } = useFetch<HistoryEntry[]>(`/api/investigations/${investigationId}/history`)
  const entries = data ?? []

  if (loading) {
    return (
      <SectionCard title="Änderungsverlauf">
        <p className="py-3 text-[12.5px] text-[#6a6a6a]">Verlauf wird geladen …</p>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Änderungsverlauf"
      count={entries.length}
      empty="Für diese Akte ist noch nichts protokolliert."
    >
      {error ? (
        <p role="alert" className="py-3 text-[12.5px] text-red-300">{error}</p>
      ) : (
        <>
          <ol className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 rounded-[10px] border border-[#232323] bg-[#111111] p-3">
                <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6a6a6a]" />
                <div className="min-w-0">
                  <p className="text-[12.5px] leading-relaxed text-[#d4d4d4]">
                    {entry.details ?? entry.action}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#6a6a6a]">
                    {entry.userName} · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {entries.length >= 100 && (
            <p className="mt-3 text-[11.5px] text-[#6a6a6a]">Nur die letzten 100 Einträge werden gezeigt.</p>
          )}
        </>
      )}
    </SectionCard>
  )
}

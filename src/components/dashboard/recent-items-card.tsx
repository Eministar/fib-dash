'use client'

import Link from 'next/link'
import { ArrowUpRight, Clock } from 'lucide-react'

import { RECENT_KIND_LABELS, useRecentItems } from '@/hooks/use-recent-items'
import { formatRelativeTime } from '@/lib/utils'

/**
 * „Weitermachen, wo du aufgehört hast“: die zuletzt geöffneten Akten,
 * Agents und Einträge – nur in diesem Browser gespeichert. Ohne Verlauf
 * rendert die Karte nichts, statt einen leeren Kasten zu zeigen.
 */
export function RecentItemsCard() {
  const items = useRecentItems()
  if (items.length === 0) return null

  return (
    <section aria-labelledby="recent-items-heading">
      <h2 id="recent-items-heading" className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-white">
        <Clock size={14} className="text-[#909090]" />
        Zuletzt geöffnet
      </h2>
      <ul className="flex gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
        {items.slice(0, 4).map((item) => (
          <li key={item.href} className="min-w-[220px] sm:min-w-0">
            <Link
              href={item.href}
              className="group flex h-full items-start justify-between gap-3 rounded-[12px] border border-[#323232]/55 bg-surface/70 px-3.5 py-3 transition-colors hover:border-[#484848] hover:bg-[#202020]"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-[#909090]">
                  {RECENT_KIND_LABELS[item.kind]}
                  {item.subtitle && <span className="font-mono text-fg-muted"> · {item.subtitle}</span>}
                </span>
                <span className="mt-0.5 block truncate text-[13.5px] font-medium text-white">{item.title}</span>
                <span className="mt-0.5 block text-[11px] text-fg-subtle">{formatRelativeTime(new Date(item.visitedAt))}</span>
              </span>
              <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-fg-subtle transition-colors group-hover:text-accent" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

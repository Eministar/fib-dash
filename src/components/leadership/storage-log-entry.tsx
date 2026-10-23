'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Crosshair } from 'lucide-react'

import { Breadcrumbs } from '@/components/layout/breadcrumbs'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Card } from '@/components/ui/card'
import { PageLoader } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { hasPermission } from '@/lib/permissions'
import { itemLabel } from '@/lib/storage-logs/storage-logs'
import { cn, formatDateTime } from '@/lib/utils'

type ContextEntry = { slug: string; direction: 'IN' | 'OUT'; item: string; quantity: number; isWeapon: boolean; storage: string; occurredAt: string }
type Detail = {
  entry: ContextEntry & {
    actorName: string
    rawText: string
    agent: { id: string; firstName: string; lastName: string; badgeNumber: string; rank: { name: string } } | null
  }
  context: ContextEntry[]
  alerts: { slug: string; weaponCount: number; itemCount: number; createdAt: string }[]
}

/** Ein Lagervorgang über seinen Slug – Ziel der Links aus den Warnungen. */
export function StorageLogEntryView({ slug }: { slug: string }) {
  const { user } = useAuth()
  const allowed = hasPermission(user, 'storage-logs:view')
  const { data, loading, error } = useFetch<Detail>(allowed ? `/api/storage-logs/${encodeURIComponent(slug)}` : null)

  if (!allowed) return <UnauthorizedContent />
  if (loading && !data) return <PageLoader />
  if (!data) return <Card className="py-14 text-center text-[13px] text-[#98989d]">{error || 'Lagereintrag nicht gefunden.'}</Card>

  const { entry, context, alerts } = data
  const out = entry.direction === 'OUT'
  const name = entry.agent ? `${entry.agent.firstName} ${entry.agent.lastName}` : entry.actorName
  const logHref = entry.agent ? `/leadership/storage?agent=${entry.agent.id}` : `/leadership/storage?actor=${encodeURIComponent(entry.actorName)}`

  return (
    <div className="mx-auto max-w-3xl pb-6">
      <Breadcrumbs className="mb-4" items={[{ label: 'Lagerlogs', href: '/leadership/storage' }, { label: name, href: logHref }, { label: entry.slug }]} />

      <Card className="mb-4">
        <p className="font-mono text-[12px] text-[#d4af37]">{entry.slug}</p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[20px] font-semibold text-white">
          {out ? <ArrowUpFromLine className="h-5 w-5 text-[#ff9f0a]" aria-hidden /> : <ArrowDownToLine className="h-5 w-5 text-[#30d158]" aria-hidden />}
          {entry.quantity}× {itemLabel(entry.item)}
          {entry.isWeapon && <span className="inline-flex items-center gap-1 rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[12px] font-medium text-[#ff9f0a]"><Crosshair className="h-3 w-3" aria-hidden />Waffe</span>}
        </h1>
        <dl className="mt-4 grid gap-x-6 gap-y-2.5 border-t border-white/[0.06] pt-4 text-[13px] sm:grid-cols-2">
          <div><dt className="text-[11.5px] text-[#8e8e93]">Vorgang</dt><dd className="text-white">{out ? 'Entnahme' : 'Einlagerung'} · {entry.storage}</dd></div>
          <div><dt className="text-[11.5px] text-[#8e8e93]">Zeitpunkt</dt><dd className="text-white">{formatDateTime(entry.occurredAt)}</dd></div>
          <div>
            <dt className="text-[11.5px] text-[#8e8e93]">Person</dt>
            <dd className="text-white">
              {entry.agent ? <Link href={`/agents/${entry.agent.id}`} className="hover:underline">{name}</Link> : name}
              {entry.agent && <span className="text-[#98989d]"> · {entry.agent.rank.name} · {displayBadgeNumber(entry.agent.badgeNumber)}</span>}
              {!entry.agent && <span className="text-[#ffb340]"> · keinem Agent zugeordnet</span>}
            </dd>
          </div>
          <div><dt className="text-[11.5px] text-[#8e8e93]">Gegenstand (technisch)</dt><dd className="font-mono text-[12.5px] text-[#c7c7cc]">{entry.item}</dd></div>
        </dl>
        <p className="mt-4 rounded-[8px] bg-[#161617] px-3 py-2 text-[12.5px] text-[#98989d]">„{entry.rawText}“</p>
      </Card>

      {alerts.length > 0 && (
        <Card className="mb-4 border border-[#ff453a]/30 bg-[#ff453a]/[0.06]">
          <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-white"><AlertTriangle className="h-4 w-4 text-[#ff6961]" aria-hidden />Teil einer Warnung</h2>
          {alerts.map((alert) => (
            <p key={alert.slug} className="text-[13px] text-[#ffb4ab]">
              <Link href={`${logHref}&alert=${alert.slug}`} className="font-mono hover:underline">{alert.slug}</Link> · {alert.weaponCount} Waffen · {alert.itemCount} Gegenstände · {formatDateTime(alert.createdAt)}
            </p>
          ))}
        </Card>
      )}

      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-white">30 Minuten davor und danach</h2>
          <Link href={logHref} className="text-[12px] text-[#0a84ff] hover:underline">Ganzes Lagerlog</Link>
        </div>
        <ul className="space-y-0.5">
          {context.map((item) => {
            const itemOut = item.direction === 'OUT'
            const Icon = itemOut ? ArrowUpFromLine : ArrowDownToLine
            return (
              <li key={item.slug}>
                <Link href={`/leadership/storage/${item.slug}`} aria-current={item.slug === entry.slug || undefined} className={cn('-mx-2 flex items-center gap-3 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-[#2c2c2e]', item.slug === entry.slug && 'bg-[#2c2c2e] ring-1 ring-inset ring-[#0a84ff]/50')}>
                  <span className="w-11 shrink-0 tabular-nums text-[#8e8e93]">{new Date(item.occurredAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', itemOut ? 'text-[#ff9f0a]' : 'text-[#30d158]')} aria-label={itemOut ? 'Entnahme' : 'Einlagerung'} />
                  <span className="min-w-0 flex-1 truncate text-white">{item.quantity}× {itemLabel(item.item)}{item.isWeapon && <Crosshair className="ml-1.5 inline h-3 w-3 text-[#ff9f0a]" aria-label="Waffe" />}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[#636366]">{item.slug}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

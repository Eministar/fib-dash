'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Popover from '@radix-ui/react-popover'
import {
  ArrowUpDown,
  Bell,
  CheckCheck,
  Clock,
  FolderSearch,
  Package,
  ShieldCheck,
  Vote,
  type LucideIcon,
} from 'lucide-react'

import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import {
  NOTIFICATION_KIND_LABELS,
  type NotificationInbox,
  type NotificationItem,
  type NotificationKind,
} from '@/lib/notifications'
import { cn, formatRelativeTime } from '@/lib/utils'

const KIND_ICONS: Record<NotificationKind, LucideIcon> = {
  INVESTIGATION_ASSIGNED: FolderSearch,
  INVESTIGATION_LEAD: ShieldCheck,
  RANK_CHANGED: ArrowUpDown,
  RANK_VOTE_OPEN: Vote,
  PROBATION_ENDING: Clock,
  EVIDENCE_TRANSFERRED: Package,
}

function kindIcon(kind: string) {
  return KIND_ICONS[kind as NotificationKind] ?? Bell
}

function kindLabel(kind: string) {
  return NOTIFICATION_KIND_LABELS[kind as NotificationKind] ?? 'Hinweis'
}

/**
 * Glocke neben der Suche. Der Abruf läuft über `useFetch` und damit im selben
 * 30-Sekunden-Takt wie alle Listen – plus sofort nach jeder eigenen Änderung
 * über das Live-Update-Signal.
 */
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { data, refetch, setData } = useFetch<NotificationInbox>('/api/notifications')
  const { execute } = useApi()

  const unread = data?.unreadCount ?? 0
  const items = data?.items ?? []

  const markRead = async (body: { ids: string[] } | { all: true }) => {
    // Sofort im UI abhaken; der Server-Stand kommt mit dem Refetch.
    setData((current) => {
      if (!current) return current
      const ids = 'ids' in body ? new Set(body.ids) : null
      const changed = current.items.filter((item) => !item.read && (!ids || ids.has(item.id))).length
      return {
        unreadCount: ids ? Math.max(0, current.unreadCount - changed) : 0,
        items: current.items.map((item) => (!ids || ids.has(item.id) ? { ...item, read: true } : item)),
      }
    })
    try {
      await execute('/api/notifications/read', { method: 'POST', body: JSON.stringify(body) })
    } finally {
      void refetch()
    }
  }

  const openItem = (item: NotificationItem) => {
    if (!item.read) void markRead({ ids: [item.id] })
    setOpen(false)
    if (item.href) router.push(item.href)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'}
          className={cn(
            'relative inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#38383a]/70 bg-[#1c1c1e]/60',
            'text-[#8e8e93] transition-colors hover:border-[#48484a] hover:text-[#c7c7cc]',
          )}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff453a] px-1 text-[10.5px] font-semibold tabular-nums text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'z-[200] w-[min(380px,calc(100vw-24px))] rounded-[12px] outline-none',
            'glass-panel-elevated border border-[#48484a]/90 shadow-[0_8px_32px_rgba(0,0,0,0.35)]',
          )}
        >
          <div className="flex items-center justify-between border-b border-[#2c2c2e] px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold text-white">Benachrichtigungen</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead({ all: true })}
                className="inline-flex items-center gap-1 text-[12px] text-[#98989d] transition-colors hover:text-white"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Alle gelesen
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-[#8e8e93]">
              Keine Benachrichtigungen in den letzten 30 Tagen.
            </p>
          ) : (
            <ul className="max-h-[min(60dvh,460px)] overflow-y-auto py-1">
              {items.map((item) => {
                const Icon = kindIcon(item.kind)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#2c2c2e]/70"
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border',
                          item.read ? 'border-[#2c2c2e] text-[#8e8e93]' : 'border-[#48484a] text-[#f5f5f7]',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('truncate text-[13px]', item.read ? 'text-[#c7c7cc]' : 'font-semibold text-white')}>
                            {item.title}
                          </span>
                          {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0a84ff]" aria-label="ungelesen" />}
                        </span>
                        {item.body && <span className="mt-0.5 block truncate text-[12px] text-[#98989d]">{item.body}</span>}
                        <span className="mt-0.5 block text-[11px] text-[#8e8e93]">
                          {kindLabel(item.kind)} · {formatRelativeTime(item.createdAt)}
                          {item.actorName ? ` · ${item.actorName}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

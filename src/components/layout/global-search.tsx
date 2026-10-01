'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Car, Clock, CornerDownLeft, EyeOff, FolderPlus, Gavel, History, LogOut, Plane, Search, UserPlus, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Modal } from '@/components/ui/modal'
import { accountNav, adminNav, mainNav, type NavItem } from '@/components/layout/sidebar'
import { useFetch } from '@/hooks/use-fetch'
import { RECENT_KIND_LABELS, useRecentItems } from '@/hooks/use-recent-items'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { SEARCH_GROUPS, isSearchable, type SearchGroup, type SearchHit } from '@/lib/global-search'
import { matchesSearch } from '@/lib/search-match'
import {
  agentHitActions,
  allowedAgentActions,
  allowedPageActions,
  type AgentActionDef,
  type PaletteActionIcon,
  type PaletteTarget,
} from '@/lib/palette-actions'
import { startPageAction } from '@/hooks/use-page-action'
import { cn } from '@/lib/utils'

/** Reihenfolge der Gruppen im Ergebnis – die häufigsten zuerst. */
const GROUP_ORDER: SearchGroup[] = ['agents', 'investigations', 'dossiers', 'persons', 'vehicles', 'mapSpots', 'entries']

const ACTION_ICONS: Record<PaletteActionIcon, LucideIcon> = {
  investigation: FolderPlus,
  person: UserRound,
  vehicle: Car,
  sanction: Gavel,
  absence: Plane,
  agent: UserPlus,
  timeline: History,
}

type PaletteItem = {
  key: string
  section: string
  title: string
  code?: string
  hint?: string
  keywords?: string[]
  icon?: LucideIcon
  classified?: boolean
  run: () => void
}

/**
 * Befehlspalette über Strg+K: Seiten, zuletzt Geöffnetes, Agents und Akten
 * in einer Liste, vollständig per Tastatur bedienbar (↑ ↓ Enter).
 * Jeder Angemeldete kann sie öffnen – welche Treffer er sieht, entscheiden
 * seine Rechte, serverseitig.
 */
export function GlobalSearch() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const recent = useRecentItems()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  /** Gewählte Agent-Aktion („Sanktion ausstellen …“) – danach wird ein Agent gesucht. */
  const [agentAction, setAgentAction] = useState<AgentActionDef | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ohne Verzögerung feuert jede Taste eine Abfrage über mehrere Tabellen.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 180)
    return () => clearTimeout(timer)
  }, [term])

  const query = open && isSearchable(debounced) ? `/api/search?q=${encodeURIComponent(debounced)}` : null
  const { data, loading, error } = useFetch<SearchHit[]>(query)
  const waiting = isSearchable(term) && (term.trim() !== debounced || loading)

  const close = () => {
    setOpen(false)
    setTerm('')
    setActive(0)
    setAgentAction(null)
  }

  const items = useMemo<PaletteItem[]>(() => {
    const go = (href: string) => () => {
      close()
      router.push(href)
    }
    const goTo = (target: PaletteTarget) => () => {
      close()
      if (target.action) startPageAction(target.path, target.action, (href) => router.push(href))
      else router.push(target.path)
    }
    const trimmed = term.trim()
    const allowed = (item: NavItem) => !item.permission || hasPermission(user, item.permission)
    const pages = [...mainNav, ...adminNav, ...accountNav].filter(allowed)

    const actions: PaletteItem[] = [
      ...(hasPermission(user, 'agents:write')
        ? [{ key: 'action:new-agent', section: 'Aktionen', title: 'Neuen Agent anlegen', icon: UserPlus, run: go('/agents/new') }]
        : []),
      ...allowedPageActions(user).map((action) => ({
        key: `action:${action.id}`,
        section: 'Aktionen',
        title: action.title,
        keywords: action.keywords,
        icon: ACTION_ICONS[action.icon],
        run: goTo({ path: action.path, action: action.action }),
      })),
      ...allowedAgentActions(user).map((action) => ({
        key: `agent-action:${action.id}`,
        section: 'Aktionen',
        title: action.title,
        keywords: action.keywords,
        hint: 'Danach Agent wählen',
        icon: ACTION_ICONS[action.icon],
        run: () => {
          setAgentAction(action)
          setTerm('')
          setActive(0)
        },
      })),
      {
        key: 'action:logout',
        section: 'Aktionen',
        title: 'Abmelden',
        icon: LogOut,
        run: () => {
          close()
          void logout()
        },
      },
    ]

    const hits = data ?? []

    // Agent-Auswahl für eine vorher gewählte Aktion: nur Agents, direkt mit Ziel.
    if (agentAction) {
      if (!isSearchable(debounced)) return []
      return hits
        .filter((hit) => hit.group === 'agents')
        .map((hit) => ({
          key: `${agentAction.id}:${hit.id}`,
          section: 'Agent wählen',
          title: agentAction.forAgent(hit.title),
          code: hit.code,
          hint: hit.hint,
          icon: ACTION_ICONS[agentAction.icon],
          run: goTo(agentAction.target(hit.id)),
        }))
    }

    if (!trimmed) {
      return [
        ...recent.slice(0, 5).map((item) => ({
          key: `recent:${item.href}`,
          section: 'Zuletzt geöffnet',
          title: item.title,
          code: item.subtitle,
          hint: RECENT_KIND_LABELS[item.kind],
          icon: Clock,
          run: go(item.href),
        })),
        ...pages.slice(0, 8).map((page) => ({
          key: `page:${page.href}`,
          section: 'Seiten',
          title: page.name,
          icon: page.icon,
          run: go(page.href),
        })),
      ]
    }

    const firstAgent = hits.find((hit) => hit.group === 'agents')
    return [
      ...pages
        .filter((page) => matchesSearch(trimmed, [page.name, page.href.replace(/[/-]/g, ' ')]))
        .slice(0, 5)
        .map((page) => ({ key: `page:${page.href}`, section: 'Seiten', title: page.name, icon: page.icon, run: go(page.href) })),
      ...actions.filter((action) => matchesSearch(trimmed, [action.title, ...(action.keywords ?? [])])),
      ...(isSearchable(debounced)
        ? GROUP_ORDER.flatMap((group) => [
            ...hits
              .filter((hit) => hit.group === group)
              .map((hit) => ({
                key: `${hit.group}:${hit.id}`,
                section: SEARCH_GROUPS[group],
                title: hit.title,
                code: hit.code,
                hint: hit.hint,
                classified: hit.classified,
                run: go(hit.href),
              })),
            // Direkt unter den Agents: Aktionen zum besten Treffer.
            ...(group === 'agents' && firstAgent
              ? agentHitActions(user, firstAgent.id, firstAgent.title).map((action) => ({
                  key: `agent-hit:${action.id}`,
                  section: `Aktionen zu ${firstAgent.title}`,
                  title: action.title,
                  icon: ACTION_ICONS[action.icon],
                  run: goTo(action.target),
                }))
              : []),
          ])
        : []),
    ]
  }, [agentAction, data, debounced, logout, recent, router, term, user])

  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && agentAction && !term) {
      event.preventDefault()
      setAgentAction(null)
      setActive(0)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (items.length ? (Math.min(index, items.length - 1) + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (items.length ? (Math.min(index, items.length - 1) - 1 + items.length) % items.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      items[activeIndex]?.run()
    }
  }

  if (!user) return null

  const sections = items.reduce<{ name: string; items: { item: PaletteItem; index: number }[] }[]>((acc, item, index) => {
    const last = acc[acc.length - 1]
    if (last?.name === item.section) last.items.push({ item, index })
    else acc.push({ name: item.section, items: [{ item, index }] })
    return acc
  }, [])

  const trimmed = term.trim()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K"
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#38383a]/70 bg-[#1c1c1e]/60 px-3',
          'text-[12.5px] text-[#8e8e93] transition-colors hover:border-[#48484a] hover:text-[#c7c7cc]',
        )}
      >
        <Search className="h-3.5 w-3.5" />
        Suchen
        <kbd className="ml-1 hidden rounded border border-[#38383a] px-1 font-mono text-[11px] text-[#8e8e93] lg:inline">Strg K</kbd>
      </button>

      <Modal open={open} onClose={close} size="xl" ariaTitle="Suche und Befehle" className="sm:top-[12vh] sm:translate-y-0">
        <div className="-mx-1 -mt-1">
          <div className="relative pr-8">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e93]" />
            <input
              autoFocus
              value={term}
              onChange={(event) => {
                setTerm(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder={
                agentAction
                  ? 'Agent suchen: Name, Dienstnummer oder Discord-ID …'
                  : 'Name, Dienstnummer, Discord-ID, Akte, Kennzeichen, Seite oder Aktion …'
              }
              aria-label="Suchen oder Befehl eingeben"
              role="combobox"
              aria-expanded
              aria-controls="palette-results"
              aria-activedescendant={items[activeIndex] ? `palette-${activeIndex}` : undefined}
              className={cn(
                'h-[42px] w-full rounded-[10px] border border-[#38383a]/70 bg-[#1c1c1e]/60 pl-9 pr-3',
                'text-[14px] text-[#f5f5f7] placeholder:text-[#8e8e93]',
                'focus:border-[#d4d4d4] focus:outline-none',
              )}
            />
          </div>

          {agentAction && (
            <p className="mt-2 flex items-center gap-2 px-1 text-[12px] text-[#98989d]">
              <span className="rounded-[6px] border border-[#48484a] px-1.5 py-0.5 text-[#f5f5f7]">{agentAction.title.replace(' …', '')}</span>
              Agent wählen · <kbd className="font-mono">⌫</kbd> zurück
            </p>
          )}

          <div ref={listRef} id="palette-results" role="listbox" className="mt-3 max-h-[min(60dvh,520px)] overflow-y-auto">
            {error && <p role="alert" className="py-6 text-center text-[12.5px] text-red-300">{error}</p>}

            {sections.map((section) => (
              <section key={section.name} className="mb-3 last:mb-0">
                <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8e8e93]">{section.name}</h3>
                <ul className="space-y-0.5">
                  {section.items.map(({ item, index }) => {
                    const Icon = item.icon ?? ArrowRight
                    const isActive = index === activeIndex
                    return (
                      <li key={item.key}>
                        <button
                          id={`palette-${index}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          data-active={isActive}
                          onClick={item.run}
                          onMouseMove={() => setActive(index)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors',
                            isActive ? 'bg-[#2c2c2e]' : 'hover:bg-[#1c1c1e]',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-[#f5f5f7]' : 'text-[#8e8e93]')} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {item.code && <span className="font-mono text-[11.5px] text-[#d4d4d4]">{item.code}</span>}
                              <span className="truncate text-[13.5px] font-medium text-white">{item.title}</span>
                              {item.classified && (
                                <span className="inline-flex items-center gap-1 rounded bg-[#7f1d1d]/40 px-1.5 text-[11px] text-[#fca5a5]">
                                  <EyeOff className="h-3 w-3" />
                                  Verschluss
                                </span>
                              )}
                            </span>
                            {item.hint && <span className="mt-0.5 block truncate text-[12px] text-[#98989d]">{item.hint}</span>}
                          </span>
                          {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[#8e8e93]" aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

            {agentAction && !trimmed && (
              <p className="py-8 text-center text-[12.5px] text-[#8e8e93]">Für wen? Name oder Dienstnummer eingeben.</p>
            )}
            {trimmed && !isSearchable(trimmed) && items.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-[#8e8e93]">Noch ein Zeichen – oder eine Dienstnummer eingeben.</p>
            )}
            {isSearchable(trimmed) && waiting && (
              <p className="py-3 text-center text-[12.5px] text-[#8e8e93]" aria-live="polite">Wird gesucht …</p>
            )}
            {isSearchable(trimmed) && !waiting && !error && items.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-[#8e8e93]">
                Nichts gefunden für „{trimmed}“. Verschlusssachen ohne Berechtigung erscheinen hier nicht.
              </p>
            )}
          </div>

          <div className="mt-3 hidden items-center gap-4 border-t border-[#3a3a3c] pt-3 text-[11px] text-[#8e8e93] sm:flex">
            <span><kbd className="font-mono">↑ ↓</kbd> auswählen</span>
            <span><kbd className="font-mono">Enter</kbd> öffnen</span>
            <span><kbd className="font-mono">Esc</kbd> schließen</span>
          </div>
        </div>
      </Modal>
    </>
  )
}

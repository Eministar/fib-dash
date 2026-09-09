'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, Search } from 'lucide-react'

import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { SEARCH_GROUPS, SEARCH_MIN_LENGTH, type SearchGroup, type SearchHit } from '@/lib/global-search'
import { cn } from '@/lib/utils'

/** Reihenfolge der Gruppen im Ergebnis – die häufigsten zuerst. */
const GROUP_ORDER: SearchGroup[] = ['investigations', 'dossiers', 'persons', 'vehicles', 'mapSpots', 'entries']

/**
 * Bereichsübergreifende Suche über Strg+K. Zahlt zurück, was die Reiter in
 * den Akten gekostet haben: Inhalt auf einem anderen Reiter findet man mit
 * Strg+F nicht mehr – hier schon.
 */
export function GlobalSearch() {
  const { user } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')

  const allowed = hasPermission(user, 'investigations:view')

  useEffect(() => {
    if (!allowed) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allowed])

  // Ohne Verzögerung feuert jede Taste eine Abfrage über sechs Tabellen.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 220)
    return () => clearTimeout(timer)
  }, [term])

  const query = debounced.length >= SEARCH_MIN_LENGTH && open
    ? `/api/search?q=${encodeURIComponent(debounced)}`
    : null
  const { data, loading, error } = useFetch<SearchHit[]>(query)
  const hits = data ?? []

  if (!allowed) return null

  const go = (hit: SearchHit) => {
    setOpen(false)
    setTerm('')
    router.push(hit.href)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3',
          'text-[12.5px] text-[#808080] transition-colors hover:border-[#404040] hover:text-[#c4c4c4]',
        )}
      >
        <Search className="h-3.5 w-3.5" />
        Suchen
        <kbd className="ml-1 rounded border border-[#343434] px-1 font-mono text-[10px] text-[#6a6a6a]">Strg K</kbd>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Suche" size="xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#808080]" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Akte, Person, Kennzeichen, Ort oder Chronologie …"
            aria-label="Bereichsübergreifend suchen"
            className={cn(
              'h-[38px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 pl-9 pr-3',
              'text-[13.5px] text-[#f4f4f4] placeholder:text-[#808080]',
              'focus:border-[#d4d4d4] focus:outline-none',
            )}
          />
        </div>

        <div className="mt-4 max-h-[55dvh] overflow-y-auto">
          {error && <p role="alert" className="py-6 text-center text-[12.5px] text-red-300">{error}</p>}

          {!error && term.trim().length < SEARCH_MIN_LENGTH && (
            <p className="py-8 text-center text-[12.5px] text-[#808080]">
              Mindestens {SEARCH_MIN_LENGTH} Zeichen eingeben.
            </p>
          )}

          {!error && term.trim().length >= SEARCH_MIN_LENGTH && loading && (
            <p className="py-8 text-center text-[12.5px] text-[#808080]">Wird gesucht …</p>
          )}

          {!error && !loading && debounced.length >= SEARCH_MIN_LENGTH && hits.length === 0 && (
            <p className="py-8 text-center text-[12.5px] text-[#808080]">
              Nichts gefunden. Verschlusssachen ohne Berechtigung erscheinen hier nicht.
            </p>
          )}

          {!loading &&
            GROUP_ORDER.map((group) => {
              const groupHits = hits.filter((hit) => hit.group === group)
              if (groupHits.length === 0) return null
              return (
                <section key={group} className="mb-4">
                  <h3 className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-[#6a6a6a]">
                    {SEARCH_GROUPS[group]}
                  </h3>
                  <ul className="space-y-1">
                    {groupHits.map((hit) => (
                      <li key={`${hit.group}-${hit.id}`}>
                        <button
                          type="button"
                          onClick={() => go(hit)}
                          className="w-full rounded-[9px] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-[#343434] hover:bg-[#1e1e1e]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {hit.code && <span className="font-mono text-[11px] text-[#d4af37]">{hit.code}</span>}
                            <span className="text-[13px] font-medium text-white">{hit.title}</span>
                            {hit.classified && (
                              <span className="inline-flex items-center gap-1 rounded bg-[#7f1d1d]/40 px-1.5 text-[10.5px] text-[#fca5a5]">
                                <EyeOff className="h-2.5 w-2.5" />
                                Verschluss
                              </span>
                            )}
                          </div>
                          {hit.hint && <p className="mt-0.5 text-[12px] leading-relaxed text-[#a6a6a6]">{hit.hint}</p>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
        </div>
      </Modal>
    </>
  )
}

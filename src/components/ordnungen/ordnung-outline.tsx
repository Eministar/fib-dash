'use client'

import { useEffect, useState } from 'react'
import { ListTree } from 'lucide-react'
import type { OutlineEntry } from '@/lib/markdown'
import { cn } from '@/lib/utils'

function OutlineLinks({ entries, active, onNavigate }: { entries: OutlineEntry[]; active: string | null; onNavigate?: () => void }) {
  return (
    <ol className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={onNavigate}
            aria-current={active === entry.id ? 'location' : undefined}
            className={cn(
              'block rounded-[6px] border-l-2 py-1.5 pr-2 text-[12.5px] leading-snug transition-colors focus-visible:outline focus-visible:outline-2',
              entry.depth === 0 ? 'pl-3' : 'pl-6 text-[12px]',
              active === entry.id
                ? 'border-accent bg-surface-raised font-medium text-white'
                : 'border-transparent text-fg-muted hover:bg-[#1f1f1f] hover:text-white',
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  )
}

/** Abschnittsleiste: rechts neben dem Dokument, auf kleinen Bildschirmen als aufklappbares Inhaltsverzeichnis. */
export function OrdnungOutline({ entries, variant }: { entries: OutlineEntry[]; variant: 'sidebar' | 'inline' }) {
  const [active, setActive] = useState<string | null>(entries[0]?.id ?? null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const targets = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((element): element is HTMLElement => !!element)
    if (targets.length === 0) return
    // Aktiv ist der letzte Abschnitt, dessen Überschrift das obere Drittel erreicht hat.
    const update = () => {
      const line = window.innerHeight * 0.3
      let current = targets[0].id
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) current = target.id
        else break
      }
      setActive(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [entries])

  if (entries.length < 2) return null

  if (variant === 'inline') {
    return (
      <div className="mb-4 rounded-[12px] border border-line bg-surface-sunken xl:hidden">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-[13px] font-medium text-[#e5e5e5]"
        >
          <span className="flex items-center gap-2"><ListTree size={15} /> Inhalt · {entries.length} Abschnitte</span>
          <span className="text-[12px] text-[#909090]">{open ? 'Schließen' : 'Anzeigen'}</span>
        </button>
        {open && <div className="border-t border-line p-2"><OutlineLinks entries={entries} active={active} onNavigate={() => setOpen(false)} /></div>}
      </div>
    )
  }

  return (
    <nav aria-label="Abschnitte" className="sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto xl:block">
      <p className="mb-2 flex items-center gap-2 px-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
        <ListTree size={13} /> Abschnitte
      </p>
      <OutlineLinks entries={entries} active={active} />
    </nav>
  )
}

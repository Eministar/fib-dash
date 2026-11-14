'use client'

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react'

/**
 * DIN-A4-Seiten fürs Blättern: Inhalte kommen als Blöcke, werden im Browser
 * gemessen und auf Seiten zu 210 × 297 mm verteilt. Jede Rubrik beginnt auf
 * einer neuen Seite; Überschriften bleiben bei ihrem Folgeblock.
 * Gezeichnet wird in echter Größe (794 × 1123 px = A4 bei 96 dpi) und für den
 * Bildschirm skaliert – gedruckt wird 1:1.
 */

export const PAGE_W = 794
export const PAGE_H = 1123
/** Satzspiegel: Breite und Höhe des Inhaltsbereichs (siehe `.a4-*` in globals.css). */
const CONTENT_W = PAGE_W - 2 * 72
const CONTENT_H = PAGE_H - 56 - 48 - 58 - 20 - 26 - 14
const HEADING_H = 62
const CONTINUED_H = 30
/** Kopfzeile samt Abstand – frei, wenn eine Rubrik ihren eigenen Briefkopf mitbringt. */
const HEADER_H = 58 + 20

export type A4Block = {
  key: string
  node: ReactNode
  /** Nicht als letzter Block einer Seite stehen lassen (Zwischenüberschriften). */
  keepWithNext?: boolean
}

export type A4Section = {
  id: string
  /** Name im Register und als Rubrikenüberschrift. */
  title: string
  blocks: A4Block[]
  /** Ganze Seite ohne Rubrikenüberschrift, z. B. Deckblatt. */
  bare?: boolean
  /** Eigener Briefkopf: erste Seite ohne Kopfzeile und Rubrikenüberschrift (z. B. Anschreiben). */
  plain?: boolean
}

export type A4Page = { section: A4Section; blocks: A4Block[]; continued: boolean; index: number }

/** Text in handliche Stücke für den Seitenumbruch: Absätze, lange Absätze nach Sätzen. */
export function splitText(text: string, max = 650): string[] {
  const parts: string[] = []
  for (const paragraph of text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    if (paragraph.length <= max) { parts.push(paragraph); continue }
    let chunk = ''
    for (const sentence of paragraph.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [paragraph]) {
      if (chunk && chunk.length + sentence.length > max) { parts.push(chunk.trim()); chunk = '' }
      chunk += sentence
    }
    if (chunk.trim()) parts.push(chunk.trim())
  }
  return parts
}

/** Seiten aus gemessenen Höhen bilden. */
function paginate(sections: A4Section[], heights: Map<string, number>): A4Page[] {
  const pages: A4Page[] = []
  for (const section of sections) {
    if (section.bare) {
      pages.push({ section, blocks: section.blocks, continued: false, index: pages.length })
      continue
    }
    let current: A4Block[] = []
    let used = 0
    let continued = false
    const limit = () => CONTENT_H - (continued ? CONTINUED_H : section.plain ? -HEADER_H : HEADING_H)
    const flush = () => {
      pages.push({ section, blocks: current, continued, index: pages.length })
      current = []; used = 0; continued = true
    }
    section.blocks.forEach((block, index) => {
      const height = heights.get(block.key) ?? 0
      const next = section.blocks[index + 1]
      // Überschrift mit dem ersten Stück des Folgeblocks zusammenhalten.
      const needed = block.keepWithNext && next ? height + Math.min(heights.get(next.key) ?? 0, 120) : height
      if (current.length && used + needed > limit()) flush()
      current.push(block)
      used += height
    })
    if (current.length || !continued) flush()
  }
  return pages
}

/** Misst alle Blöcke unsichtbar in Seitenbreite und liefert die Seiten. */
export function usePagination(sections: A4Section[]) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState<Map<string, number> | null>(null)
  const signature = sections.map((section) => `${section.id}:${section.blocks.map((block) => block.key).join(',')}`).join('|')

  const measure = useCallback(() => {
    const root = measureRef.current
    if (!root) return
    const next = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('[data-a4-block]').forEach((element) => next.set(element.dataset.a4Block!, element.offsetHeight))
    setHeights(next)
  }, [])

  useLayoutEffect(() => {
    measure()
    // Schriften und Bilder können die Höhe noch ändern.
    let cancelled = false
    void document.fonts?.ready.then(() => { if (!cancelled) measure() })
    const timer = window.setTimeout(measure, 400)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [signature, measure])

  const pages = useMemo(() => (heights ? paginate(sections, heights) : []), [sections, heights])

  const measurer = (
    <div ref={measureRef} aria-hidden className="a4-measure" style={{ width: CONTENT_W }}>
      {sections.filter((section) => !section.bare).flatMap((section) => section.blocks).map((block) => (
        <div key={block.key} data-a4-block={block.key} className="a4-block">{block.node}</div>
      ))}
    </div>
  )
  return { pages, measurer, ready: heights !== null }
}

/** Eine Seite in Originalgröße. */
export function A4PageView({ page, total, header, footer }: { page: A4Page; total: number; header: ReactNode; footer: ReactNode }) {
  if (page.section.bare) {
    return (
      <div className="a4-page a4-page-bare">
        {page.blocks.map((block) => <Fragment key={block.key}>{block.node}</Fragment>)}
        <span className="a4-punch a4-punch-top" aria-hidden />
        <span className="a4-punch a4-punch-bottom" aria-hidden />
      </div>
    )
  }
  return (
    <div className="a4-page">
      <span className="a4-punch a4-punch-top" aria-hidden />
      <span className="a4-punch a4-punch-bottom" aria-hidden />
      {(page.continued || !page.section.plain) && <header className="a4-header">{header}</header>}
      <div className="a4-body">
        {page.continued
          ? <p className="a4-continued">{page.section.title} · Fortsetzung</p>
          : !page.section.plain && <h2 className="a4-section-title">{page.section.title}</h2>}
        {page.blocks.map((block) => <div key={block.key} className="a4-block">{block.node}</div>)}
      </div>
      <footer className="a4-footer">
        <span>{footer}</span>
        <span className="tabular-nums">Seite {page.index + 1} von {total}</span>
      </footer>
    </div>
  )
}

const TAB_COLORS = ['#c9a227', '#3f7cc0', '#3e9a6b', '#b8543e', '#7d5bbf', '#2f8f9d', '#a8466f', '#6b7280']

/**
 * Geöffneter Aktenordner: Seite in der Mitte, Registerblätter rechts,
 * Blättern per Pfeiltasten, Wischen oder Knöpfen, Druck aller Seiten.
 */
export function BinderViewer({ title, eyebrow, color, sections, header, footer, onClose, initialSection }: {
  title: string
  eyebrow: string
  /** Farbe des Ordnerrückens. */
  color: string
  sections: A4Section[]
  header: ReactNode
  footer: ReactNode
  onClose: () => void
  initialSection?: string
}) {
  const { pages, measurer, ready } = usePagination(sections)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const reduce = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  const jumped = useRef(false)

  const total = pages.length
  const current = pages[Math.min(index, Math.max(0, total - 1))]

  const go = useCallback((target: number) => {
    const next = Math.max(0, Math.min(total - 1, target))
    if (next === index) return
    setDirection(next > index ? 1 : -1)
    setIndex(next)
  }, [total, index])

  useEffect(() => {
    if (jumped.current || !initialSection || !pages.length) return
    jumped.current = true
    const first = pages.findIndex((page) => page.section.id === initialSection)
    if (first > 0) setIndex(first)
  }, [pages, initialSection])

  // Seite so groß wie möglich, ohne zu scrollen.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => {
      const { width, height } = stage.getBoundingClientRect()
      // Platz für Ordnerrücken links und Register rechts.
      const reserve = window.innerWidth >= 900 ? 240 : 0
      setScale(Math.max(0.28, Math.min((width - reserve) / PAGE_W, height / PAGE_H, 1.15)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(event.target.tagName)) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); go(index + 1) }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(index - 1) }
      else if (event.key === 'Home') go(0)
      else if (event.key === 'End') go(total - 1)
      else if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, total, onClose])

  useEffect(() => {
    document.body.classList.add('binder-open')
    return () => document.body.classList.remove('binder-open')
  }, [])

  const tabs = sections.map((section, position) => ({
    section,
    color: TAB_COLORS[position % TAB_COLORS.length],
    first: pages.findIndex((page) => page.section.id === section.id),
  })).filter((tab) => tab.first >= 0)

  const variants = {
    enter: (dir: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: dir * 70, rotateY: dir * -18, scale: 0.985 }),
    center: { opacity: 1, x: 0, rotateY: 0, scale: 1 },
    exit: (dir: number) => (reduce ? { opacity: 0 } : { opacity: 0, x: dir * -70, rotateY: dir * 18, scale: 0.985 }),
  }

  return (
    <div className="binder-viewer" role="dialog" aria-modal="true" aria-label={`${eyebrow}: ${title}`}>
      {measurer}
      <div className="binder-toolbar">
        <div className="min-w-0">
          <p className="binder-eyebrow" style={{ color }}>{eyebrow}</p>
          <h2 className="binder-title">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="binder-tool" onClick={() => window.print()} title="Alle Seiten drucken oder als PDF speichern">
            <Printer size={16} /><span className="hidden sm:inline">Drucken</span>
          </button>
          <button type="button" className="binder-tool" onClick={onClose} title="Ordner schließen (Esc)">
            <X size={16} /><span className="hidden sm:inline">Schließen</span>
          </button>
        </div>
      </div>

      <nav className="binder-tabs-mobile" aria-label="Register">
        {tabs.map((tab) => (
          <button key={tab.section.id} type="button" onClick={() => go(tab.first)} aria-current={current?.section.id === tab.section.id} style={{ ['--tab' as string]: tab.color }}>
            {tab.section.title}
          </button>
        ))}
      </nav>

      <div className="binder-desk">
        <div ref={stageRef} className="binder-stage">
          {!ready || !current ? (
            <p className="binder-loading">Seiten werden gesetzt …</p>
          ) : (
            <div className="binder-sheet" style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
              <div className="binder-spine" style={{ ['--binder' as string]: color }} aria-hidden>
                <span className="binder-ring" />
                <span className="binder-ring" />
              </div>
            <nav className="binder-tabs" aria-label="Register">
              {tabs.map((tab) => (
                <button
                  key={tab.section.id}
                  type="button"
                  onClick={() => go(tab.first)}
                  aria-current={current?.section.id === tab.section.id}
                  style={{ ['--tab' as string]: tab.color }}
                >
                  {tab.section.title}
                </button>
              ))}
            </nav>
              <div className="binder-paper-stack" aria-hidden style={{ opacity: total - index > 1 ? 1 : 0 }} />
              <AnimatePresence initial={false} custom={direction}>
                <motion.div
                  key={current.index}
                  custom={direction}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduce ? 0.12 : 0.38, ease: [0.22, 0.8, 0.24, 1] }}
                  className="binder-page-motion"
                  style={{ transformOrigin: direction > 0 ? 'left center' : 'right center' }}
                  drag={reduce ? false : 'x'}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.18}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -70 || info.velocity.x < -500) go(index + 1)
                    else if (info.offset.x > 70 || info.velocity.x > 500) go(index - 1)
                  }}
                >
                  <div style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                    <A4PageView page={current} total={total} header={header} footer={footer} />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <div className="binder-pager">
        <button type="button" className="binder-flip" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Vorherige Seite">
          <ChevronLeft size={20} />
        </button>
        <span className="binder-count tabular-nums" aria-live="polite">{total ? `Seite ${index + 1} von ${total}` : '…'}</span>
        <button type="button" className="binder-flip" onClick={() => go(index + 1)} disabled={index >= total - 1} aria-label="Nächste Seite">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Druck: alle Seiten in Originalgröße. */}
      <div className="binder-print" aria-hidden>
        {pages.map((page) => <A4PageView key={page.index} page={page} total={total} header={header} footer={footer} />)}
      </div>
    </div>
  )
}

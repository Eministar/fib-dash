'use client'

import { useEffect, useRef, useState } from 'react'

const SHOW_DELAY_MS = 350
const GAP = 8
const TOOLTIP_ID = 'fib-title-tooltip'

type Tip = { text: string; x: number; y: number; placement: 'top' | 'bottom' }

/**
 * Macht aus jedem `title="…"` im Dashboard einen echten Tooltip: schneller,
 * im Dashboard-Look, auch bei Tastaturfokus und ohne dass jede der ~200
 * Stellen umgebaut werden muss. Solange der Tooltip sichtbar ist, wandert
 * das `title` in `data-fib-title`, damit der Browser-Tooltip nicht doppelt
 * erscheint. Icon-Knöpfe ohne Beschriftung erhalten dabei ein `aria-label`.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const current = useRef<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const restore = () => {
      window.clearTimeout(timer.current)
      const el = current.current
      if (el) {
        const saved = el.getAttribute('data-fib-title')
        if (saved !== null) {
          el.setAttribute('title', saved)
          el.removeAttribute('data-fib-title')
        }
        if (el.getAttribute('aria-describedby') === TOOLTIP_ID) el.removeAttribute('aria-describedby')
      }
      current.current = null
      setTip(null)
    }

    const activate = (target: EventTarget | null, immediate: boolean) => {
      const el = (target as Element | null)?.closest?.('[title]') as HTMLElement | null
      if (!el || el === current.current) return
      // Diagramme/SVG-Titel und leere Titel in Ruhe lassen.
      if (el instanceof SVGElement || el.closest('svg')) return
      const text = el.getAttribute('title')?.trim()
      if (!text) return
      restore()
      current.current = el
      el.setAttribute('data-fib-title', text)
      el.removeAttribute('title')
      // Reine Icon-Knöpfe hatten nur das title als Namen – der darf nicht verschwinden.
      if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text)

      const show = () => {
        if (current.current !== el || !el.isConnected) return
        const rect = el.getBoundingClientRect()
        const placement = rect.top > 48 ? 'top' : 'bottom'
        setTip({
          text,
          x: rect.left + rect.width / 2,
          y: placement === 'top' ? rect.top - GAP : rect.bottom + GAP,
          placement,
        })
        el.setAttribute('aria-describedby', TOOLTIP_ID)
      }
      window.clearTimeout(timer.current)
      if (immediate) show()
      else timer.current = window.setTimeout(show, SHOW_DELAY_MS)
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      activate(event.target, false)
    }
    const onOut = (event: PointerEvent) => {
      const el = current.current
      if (el && !el.contains(event.relatedTarget as Node | null)) restore()
    }
    const onFocus = (event: FocusEvent) => {
      if ((event.target as Element | null)?.matches?.(':focus-visible')) activate(event.target, true)
    }
    const onBlur = () => restore()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') restore()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('pointerdown', restore, true)
    window.addEventListener('scroll', restore, true)
    window.addEventListener('keydown', onKey)
    return () => {
      restore()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('pointerdown', restore, true)
      window.removeEventListener('scroll', restore, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!tip) return null

  // Am Bildschirmrand nicht abschneiden.
  const maxWidth = 260
  const left = Math.min(Math.max(tip.x, maxWidth / 2 + 8), window.innerWidth - maxWidth / 2 - 8)

  return (
    <div
      id={TOOLTIP_ID}
      role="tooltip"
      className="title-tooltip pointer-events-none fixed z-[130] w-max max-w-[260px] rounded-[7px] border border-[#38383a] bg-[#1c1c1e] px-2.5 py-1.5 text-[12px] font-medium leading-snug text-[#f5f5f7] shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
      style={{
        left,
        top: tip.y,
        transform: `translate(-50%, ${tip.placement === 'top' ? '-100%' : '0'})`,
      }}
    >
      {tip.text}
    </div>
  )
}

import mapUrl from '../assets/map.webp'
import { escapeHtml } from '../dom'
import { icon } from '../icons'
import { MAP_HEIGHT, MAP_WIDTH } from '../../../src/lib/investigations/map-spots'

// Stadtkarte mit Zoom, Verschieben und Nadeln. Das Bild ist eine verkleinerte
// WebP-Fassung von `src/assets/map.png` (gleiches Seitenverhältnis), damit die
// App nicht 20 MB mitschleppt. Positionen sind wie im Dashboard Prozentwerte.

export type MapPin = {
  id: string
  x: number
  y: number
  color: string
  label: string
  /** Zeichen im Nadelkopf, z. B. Emoji der Kategorie. */
  glyph?: string | null
  selected?: boolean
  /** Ausgegraut, z. B. Punkte, die nicht zum Filter passen. */
  muted?: boolean
}

export interface CityMap {
  setPins(pins: MapPin[]): void
  /** Vorschaunadel für einen noch nicht gespeicherten Ort. */
  setPending(position: { x: number; y: number } | null): void
  focus(id: string): void
  fit(): void
}

interface Options {
  onPin?: (id: string) => void
  /** Klick auf freie Fläche – Koordinaten in Prozent. */
  onPlace?: (position: { x: number; y: number }) => void
}

const BASE_WIDTH = 1000
const BASE_HEIGHT = (BASE_WIDTH * MAP_HEIGHT) / MAP_WIDTH
const MAX_ZOOM = 14
const CLICK_TOLERANCE = 5

export function createCityMap(host: HTMLElement, options: Options = {}): CityMap {
  host.classList.add('city-map')
  if (options.onPlace) host.classList.add('placing')
  host.innerHTML = `
    <div class="city-map-stage">
      <img class="city-map-image" src="${mapUrl}" alt="" draggable="false">
      <div class="city-map-pins"></div>
    </div>
    <div class="city-map-controls">
      <button type="button" data-zoom="in" title="Vergrößern" aria-label="Vergrößern">${icon('zoomIn')}</button>
      <button type="button" data-zoom="out" title="Verkleinern" aria-label="Verkleinern">${icon('zoomOut')}</button>
      <button type="button" data-zoom="fit" title="Ganze Karte" aria-label="Ganze Karte">${icon('map')}</button>
    </div>`
  const stage = host.querySelector<HTMLElement>('.city-map-stage')!
  const layer = host.querySelector<HTMLElement>('.city-map-pins')!
  stage.style.width = `${BASE_WIDTH}px`
  stage.style.height = `${BASE_HEIGHT}px`

  let scale = 1
  let tx = 0
  let ty = 0
  let fitted = false
  let pending: { x: number; y: number } | null = null
  let pins: MapPin[] = []

  const minScale = () => Math.min(host.clientWidth / BASE_WIDTH, host.clientHeight / BASE_HEIGHT) || 1

  function apply() {
    const min = minScale()
    scale = Math.min(Math.max(scale, min), min * MAX_ZOOM)
    // Karte bleibt im Bild: kleiner als der Rahmen → mittig, sonst bündig.
    const w = BASE_WIDTH * scale
    const h = BASE_HEIGHT * scale
    tx = w <= host.clientWidth ? (host.clientWidth - w) / 2 : Math.min(0, Math.max(host.clientWidth - w, tx))
    ty = h <= host.clientHeight ? (host.clientHeight - h) / 2 : Math.min(0, Math.max(host.clientHeight - h, ty))
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    stage.style.setProperty('--pin-scale', String(1 / scale))
  }

  function zoomAt(factor: number, cx = host.clientWidth / 2, cy = host.clientHeight / 2) {
    const before = scale
    const min = minScale()
    scale = Math.min(Math.max(scale * factor, min), min * MAX_ZOOM)
    tx = cx - ((cx - tx) * scale) / before
    ty = cy - ((cy - ty) * scale) / before
    apply()
  }

  function fit() {
    scale = minScale()
    apply()
  }

  function renderPins() {
    const all = pending ? [...pins, { id: '', ...pending, color: 'var(--colorBrandBackground)', label: 'Neuer Ort', glyph: '+', selected: true }] : pins
    layer.innerHTML = all
      .map(
        (pin) => `<button type="button" class="map-pin${pin.selected ? ' selected' : ''}${pin.muted ? ' muted' : ''}${pin.id ? '' : ' pending'}"
          data-pin="${escapeHtml(pin.id)}" style="left:${pin.x}%;top:${pin.y}%;--pin-color:${pin.color}" title="${escapeHtml(pin.label)}" aria-label="${escapeHtml(pin.label)}">
          <span class="map-pin-head"><span class="map-pin-glyph">${pin.glyph ? escapeHtml(pin.glyph) : ''}</span></span></button>`,
      )
      .join('')
  }

  host.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      const rect = host.getBoundingClientRect()
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.0025), event.clientX - rect.left, event.clientY - rect.top)
    },
    { passive: false },
  )

  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('.city-map-controls')) return
    drag = { x: event.clientX, y: event.clientY, tx, ty, moved: false }
    host.setPointerCapture(event.pointerId)
  })
  host.addEventListener('pointermove', (event) => {
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) return
    drag.moved = true
    host.classList.add('dragging')
    tx = drag.tx + dx
    ty = drag.ty + dy
    apply()
  })
  const release = (event: PointerEvent) => {
    const start = drag
    drag = null
    host.classList.remove('dragging')
    if (!start || start.moved || event.type === 'pointercancel') return
    // Mit Pointer-Capture landet das Ereignis am Rahmen – Ziel neu bestimmen.
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-pin]')
    if (hit && host.contains(hit)) {
      if (hit.dataset.pin) options.onPin?.(hit.dataset.pin)
      return
    }
    if (!options.onPlace) return
    const rect = host.getBoundingClientRect()
    const x = ((event.clientX - rect.left - tx) / scale / BASE_WIDTH) * 100
    const y = ((event.clientY - rect.top - ty) / scale / BASE_HEIGHT) * 100
    if (x >= 0 && x <= 100 && y >= 0 && y <= 100) options.onPlace({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
  }
  host.addEventListener('pointerup', release)
  host.addEventListener('pointercancel', release)
  // Tastatur: Enter/Leertaste auf einer Nadel (Mausklicks laufen über `release`).
  layer.addEventListener('click', (event) => {
    const id = (event.target as Element).closest<HTMLElement>('[data-pin]')?.dataset.pin
    if (event.detail === 0 && id) options.onPin?.(id)
  })

  host.querySelector('.city-map-controls')!.addEventListener('click', (event) => {
    const zoom = (event.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom
    if (zoom === 'fit') fit()
    else if (zoom) zoomAt(zoom === 'in' ? 1.6 : 1 / 1.6)
  })

  // Erst messen, wenn der Rahmen sichtbar ist (Reiter, Dialoge).
  new ResizeObserver(() => {
    if (!host.clientWidth || !host.clientHeight) return
    if (!fitted) {
      fitted = true
      fit()
    } else apply()
  }).observe(host)

  return {
    setPins(next) {
      pins = next
      renderPins()
    },
    setPending(position) {
      pending = position
      renderPins()
    },
    focus(id) {
      const pin = pins.find((p) => p.id === id)
      if (!pin || !host.clientWidth) return
      scale = Math.max(scale, minScale() * 4)
      tx = host.clientWidth / 2 - (pin.x / 100) * BASE_WIDTH * scale
      ty = host.clientHeight / 2 - (pin.y / 100) * BASE_HEIGHT * scale
      apply()
    },
    fit,
  }
}

'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import Image from 'next/image'
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { LocateFixed, Minus, Move, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MAP_HEIGHT, MAP_WIDTH, mapCategory, type MapSpot } from '@/lib/map-spots'
import { MapNeedle } from '@/components/map/map-needle'

const MIN_SCALE = 1
const MAX_SCALE = 16
/** Kleiner Faktor = feineres Zoomen. Exponentiell, damit jede Raststufe gleich viel bewirkt. */
const WHEEL_SENSITIVITY = 0.0022
const WHEEL_MAX_DELTA = 100
/** Bis hierhin gilt ein Zeigerweg noch als Klick und nicht als Ziehen der Karte. */
const CLICK_TOLERANCE_PX = 5

export interface CityMapHandle {
  focusSpot: (id: string) => void
}

interface CityMapProps {
  spots: MapSpot[]
  canManage: boolean
  /** Klick auf freie Fläche im Normalmodus – Koordinaten in Prozent. */
  onPlace: (position: { x: number; y: number }) => void
  onOpenDetail: (spot: MapSpot) => void
  /** Markierung, die gerade auf eine neue Position wartet. */
  movingSpot: MapSpot | null
  moving: boolean
  onMoveTo: (position: { x: number; y: number }) => void
  onCancelMove: () => void
  /** Vorschaunadel für die noch nicht gespeicherte Markierung. */
  pendingPosition: { x: number; y: number } | null
  /** Im Auswahlmodus markierte Punkte. */
  selectedIds?: string[]
  /** Klick auf eine Nadel wählt aus, statt die Detailansicht zu öffnen. */
  selectable?: boolean
}

export const CityMap = forwardRef<CityMapHandle, CityMapProps>(function CityMap(
  {
    spots,
    canManage,
    onPlace,
    onOpenDetail,
    movingSpot,
    moving,
    onMoveTo,
    onCancelMove,
    pendingPosition,
    selectedIds = [],
    selectable = false,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<ReactZoomPanPinchRef | null>(null)
  const imageRef = useRef<HTMLDivElement | null>(null)
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const focusSpot = useCallback((id: string) => {
    const element = document.getElementById(`map-spot-${id}`)
    if (!element || !controlsRef.current) return
    controlsRef.current.zoomToElement(element, 9, 420, 'easeOut')
  }, [])

  useImperativeHandle(ref, () => ({ focusSpot }), [focusSpot])

  const onPointerDown = (event: PointerEvent) => {
    pointerDownRef.current = { x: event.clientX, y: event.clientY }
  }

  const onMapClick = (event: MouseEvent<HTMLDivElement>) => {
    const down = pointerDownRef.current
    // Ohne diese Prüfung würde jedes Verschieben der Karte am Ende einen Punkt setzen.
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return

    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    if (x < 0 || x > 100 || y < 0 || y > 100) return

    if (movingSpot) {
      if (!moving) onMoveTo({ x, y })
      return
    }
    if (canManage) onPlace({ x, y })
  }

  /**
   * Die Nadeln sollen bei jedem Zoom gleich groß bleiben. Statt sie einzeln neu
   * zu rendern, hängt ihre Skalierung an einer CSS-Variablen auf dem Container.
   */
  const onTransform = useCallback(
    (_ref: ReactZoomPanPinchRef, state: { scale: number }) => {
      imageRef.current?.style.setProperty('--marker-scale', String(1 / Math.max(state.scale, 0.01)))
    },
    [],
  )

  // Eigener Wheel-Handler: die eingebaute Variante zoomt in festen Stufen und
  // nicht exakt auf den Cursor. `passive: false` ist Pflicht, sonst lässt sich
  // das Scrollen der Seite nicht unterdrücken.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()

      const controls = controlsRef.current
      const wrapper = controls?.instance.wrapperComponent
      if (!controls || !wrapper) return

      const modeMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientHeight
            : 1
      const delta = Math.max(
        -WHEEL_MAX_DELTA,
        Math.min(WHEEL_MAX_DELTA, event.deltaY * modeMultiplier),
      )

      const currentScale = controls.state.scale
      const nextScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, currentScale * Math.exp(-delta * WHEEL_SENSITIVITY)),
      )
      if (Math.abs(nextScale - currentScale) < 0.0001) return

      // Der Punkt unter dem Cursor muss unter dem Cursor bleiben.
      const rect = wrapper.getBoundingClientRect()
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      const contentX = (cursorX - controls.state.positionX) / currentScale
      const contentY = (cursorY - controls.state.positionY) / currentScale

      controls.setTransform(cursorX - contentX * nextScale, cursorY - contentY * nextScale, nextScale, 0)
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    if (!movingSpot) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelMove()
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [movingSpot, onCancelMove])

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden rounded-[12px] border border-[#2a2a2a] bg-[#111111]"
    >
      <TransformWrapper
        ref={controlsRef}
        initialScale={1}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        limitToBounds
        centerOnInit
        smooth
        wheel={{ disabled: true }}
        doubleClick={{ mode: 'reset' }}
        panning={{ velocityDisabled: true }}
        onTransform={onTransform}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-full !w-full">
              <div
                ref={imageRef}
                onPointerDown={onPointerDown}
                onClick={onMapClick}
                className={`relative mx-auto h-full ${
                  movingSpot ? 'cursor-cell' : canManage ? 'cursor-crosshair' : 'cursor-grab'
                }`}
                style={{ aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}` }}
              >
                <Image
                  src="/api/map/image"
                  alt="Stadtkarte"
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, calc(100vw - 620px)"
                  className="pointer-events-none select-none object-contain"
                  draggable={false}
                />

                {spots.map((spot) => {
                  const category = mapCategory(spot.category)
                  const relocating = movingSpot?.id === spot.id
                  return (
                    <button
                      key={spot.id}
                      id={`map-spot-${spot.id}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        // Im Auswahlmodus hakt der Linksklick an; ein Rechtsklick
                        // zum Auswählen fände niemand.
                        if (selectable) return onOpenDetail(spot)
                        focusSpot(spot.id)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        focusSpot(spot.id)
                        onOpenDetail(spot)
                      }}
                      onMouseEnter={() => setHovered(spot.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`group absolute z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full outline-none ${
                        relocating ? 'animate-pulse' : ''
                      } ${selectable && selectedIds.includes(spot.id) ? 'ring-4 ring-[#a78bfa]' : ''}`}
                      style={{
                        left: `${spot.x}%`,
                        top: `${spot.y}%`,
                        transform: 'translate(-50%, -100%) scale(var(--marker-scale, 1))',
                        transformOrigin: '50% 100%',
                      }}
                      aria-label={selectable ? `${spot.title} auswählen` : `${spot.title}. Rechtsklick für Details.`}
                      aria-pressed={selectable ? selectedIds.includes(spot.id) : undefined}
                    >
                      <MapNeedle color={category.hex} icon={spot.icon} pending={relocating} />
                      {hovered === spot.id && (
                        <span className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-[8px] border border-[#343434] bg-[#181818] px-2.5 py-1.5 text-[11.5px] font-medium text-white shadow-lg">
                          {spot.title}
                        </span>
                      )}
                    </button>
                  )
                })}

                {pendingPosition && (
                  <span
                    className="pointer-events-none absolute z-20 grid h-6 w-6 place-items-center"
                    style={{
                      left: `${pendingPosition.x}%`,
                      top: `${pendingPosition.y}%`,
                      transform: 'translate(-50%, -100%) scale(var(--marker-scale, 1))',
                      transformOrigin: '50% 100%',
                    }}
                  >
                    <MapNeedle color="#a78bfa" pending />
                  </span>
                )}
              </div>
            </TransformComponent>

            <div className="absolute right-3 top-3 z-30 flex rounded-[11px] border border-[#2a2a2a] bg-[#141414]/90 p-1 backdrop-blur">
              <Button
                variant="ghost"
                onClick={() => zoomIn(0.18, 180, 'easeOut')}
                className="h-9 w-9 px-0"
                aria-label="Hineinzoomen"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => zoomOut(0.18, 180, 'easeOut')}
                className="h-9 w-9 px-0"
                aria-label="Herauszoomen"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => resetTransform(180, 'easeOut')}
                className="h-9 w-9 px-0"
                aria-label="Ansicht zurücksetzen"
              >
                <LocateFixed className="h-4 w-4" />
              </Button>
            </div>

            {movingSpot && (
              <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-8rem)] -translate-x-1/2 items-center gap-3 rounded-[11px] border border-[#a78bfa]/40 bg-[#141414]/95 px-3 py-2 backdrop-blur">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#a78bfa]/12 text-[#c4b5fd]">
                  <Move className="h-3.5 w-3.5" />
                </span>
                <p className="min-w-0 truncate text-[12px] text-white">
                  <span className="font-semibold">{movingSpot.title}</span>
                  <span className="text-[#a6a6a6]"> · neue Position anklicken</span>
                </p>
                <Button
                  variant="ghost"
                  disabled={moving}
                  onClick={onCancelMove}
                  className="h-7 w-7 shrink-0 px-0"
                  aria-label="Verschieben abbrechen"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 hidden -translate-x-1/2 rounded-[9px] border border-[#2a2a2a] bg-[#141414]/85 px-3 py-2 text-[11px] text-[#808080] backdrop-blur sm:block">
              Mausrad zoomt auf den Cursor
              <span className="px-1.5 text-[#404040]">·</span>
              Ziehen verschiebt die Karte
              <span className="px-1.5 text-[#404040]">·</span>
              Rechtsklick auf eine Nadel öffnet Details
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  )
})

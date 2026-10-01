'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Crosshair, ExternalLink, Maximize2, Minus, Plus, Search } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useAuth } from '@/context/auth-context'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFetch } from '@/hooks/use-fetch'
import { isSearchable, type SearchHit } from '@/lib/global-search'
import {
  GRAPH_NODE_KIND_LABELS,
  layoutGraph,
  nodeKey,
  parseNodeKey,
  type GraphNode,
  type GraphNodeKind,
  type LinkGraph,
  type Point,
} from '@/lib/link-graph'
import { hasPermission } from '@/lib/permissions'

const WIDTH = 1000
const HEIGHT = 700
const MIN_ZOOM = 0.3
const MAX_ZOOM = 4
/** Zeigerweg, bis aus einem Klick ein Ziehen wird. */
const DRAG_THRESHOLD = 4

const KIND_COLORS: Record<GraphNodeKind, string> = {
  investigation: '#a78bfa',
  person: '#64d2ff',
  vehicle: '#ffd60a',
}

const SEARCH_KIND: Partial<Record<SearchHit['group'], GraphNodeKind>> = {
  investigations: 'investigation',
  persons: 'person',
  vehicles: 'vehicle',
}

function nodeHref(node: Pick<GraphNode, 'kind' | 'id'>) {
  if (node.kind === 'investigation') return `/investigations/${node.id}`
  if (node.kind === 'person') return `/investigations/persons?person=${node.id}`
  return `/investigations/vehicles?vehicle=${node.id}`
}

function shorten(text: string, max = 24) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

type View = { x: number; y: number; k: number }
const INITIAL_VIEW: View = { x: 0, y: 0, k: 1 }

/**
 * Netzwerk aus Akten, Personen und Fahrzeugen um einen Fokus. Hintergrund
 * ziehen verschiebt, Mausrad zoomt, Knoten lassen sich ziehen. Klick wählt
 * aus, Doppelklick setzt den Fokus neu.
 */
export function LinkGraphView() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const canView = hasPermission(user, 'investigations:view')

  const focus = parseNodeKey(searchParams.get('focus'))
  const focusParam = focus ? nodeKey(focus.kind, focus.id) : null
  const depth = ['1', '2', '3'].includes(searchParams.get('depth') ?? '') ? searchParams.get('depth')! : '2'

  const { data: graph, loading, error } = useFetch<LinkGraph>(
    canView && focusParam ? `/api/investigations/graph?focus=${encodeURIComponent(focusParam)}&depth=${depth}` : null,
  )

  const setParams = useCallback(
    (next: { focus?: string; depth?: string }) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.focus) params.set('focus', next.focus)
      if (next.depth) params.set('depth', next.depth)
      router.replace(`/investigations/graph?${params}`, { scroll: false })
    },
    [router, searchParams],
  )

  if (!canView) return <UnauthorizedContent />

  return (
    <div>
      <PageHeader
        eyebrow="Ermittlungen"
        title="Netzwerk"
        description="Wer hängt mit wem zusammen? Akten, Personen und Fahrzeuge mit ihren Verknüpfungen."
      />
      <InvestigationsNavigation active="graph" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FocusSearch onPick={(key) => setParams({ focus: key })} />
        <div className="w-[170px]">
          <Select
            label="Tiefe"
            options={[
              { value: '1', label: '1 Schritt' },
              { value: '2', label: '2 Schritte' },
              { value: '3', label: '3 Schritte' },
            ]}
            value={depth}
            onValueChange={(value) => setParams({ depth: value })}
          />
        </div>
      </div>

      {!focusParam ? (
        <Card className="py-14 text-center text-[13px] text-[#98989d]">
          Wähle oben eine Akte, Person oder ein Fahrzeug als Ausgangspunkt – oder öffne das Netzwerk direkt aus einer Akte.
        </Card>
      ) : error ? (
        <Card className="py-14 text-center text-[13px] text-[#98989d]">{error}</Card>
      ) : !graph || (loading && graph.focus !== focusParam) ? (
        <Card className="py-14 text-center text-[13px] text-[#8e8e93]">Netzwerk wird aufgebaut …</Card>
      ) : (
        <GraphCanvas key={`${graph.focus}:${depth}`} graph={graph} onFocus={(key) => setParams({ focus: key })} />
      )}
    </div>
  )
}

function FocusSearch({ onPick }: { onPick: (key: string) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebouncedValue(term.trim(), 250)
  const { data } = useFetch<SearchHit[]>(isSearchable(debounced) ? `/api/search?q=${encodeURIComponent(debounced)}` : null)
  const hits = (data ?? []).filter((hit) => SEARCH_KIND[hit.group]).slice(0, 12)

  return (
    <div className="relative min-w-[260px] flex-1">
      <label className="mb-1.5 block text-[12.5px] font-medium text-[#c7c7cc]" htmlFor="graph-focus">
        Ausgangspunkt
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e93]" />
        <input
          id="graph-focus"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Akte, Person oder Kennzeichen suchen …"
          className="h-[36px] w-full rounded-[9px] border border-[#38383a]/70 bg-[#1c1c1e]/60 pl-9 pr-3 text-[13.5px] text-[#f5f5f7] placeholder:text-[#8e8e93] focus:border-[#d4d4d4] focus:outline-none"
        />
      </div>
      {open && hits.length > 0 && (
        <ul className="glass-panel-elevated absolute z-20 mt-1 max-h-[320px] w-full overflow-y-auto rounded-[10px] border border-[#48484a] py-1">
          {hits.map((hit) => {
            const kind = SEARCH_KIND[hit.group]!
            return (
              <li key={`${hit.group}:${hit.id}`}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onPick(nodeKey(kind, hit.id))
                    setTerm('')
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#2c2c2e]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[kind] }} />
                  {hit.code && <span className="font-mono text-[11.5px] text-[#d4d4d4]">{hit.code}</span>}
                  <span className="truncate text-[13px] text-white">{hit.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-[#8e8e93]">{GRAPH_NODE_KIND_LABELS[kind]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function GraphCanvas({ graph, onFocus }: { graph: LinkGraph; onFocus: (key: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const layout = useMemo(() => layoutGraph(graph, { width: WIDTH, height: HEIGHT }), [graph])
  const [moved, setMoved] = useState<Record<string, Point>>({})
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(graph.focus)
  const drag = useRef<{ kind: 'pan' | 'node'; key?: string; startX: number; startY: number; origin: Point; moved: boolean } | null>(null)

  const position = (key: string) => moved[key] ?? layout[key]
  const nodesByKey = useMemo(() => new Map(graph.nodes.map((node) => [node.key, node])), [graph.nodes])

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const edge of graph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)!.add(edge.target)
      map.get(edge.target)!.add(edge.source)
    }
    return map
  }, [graph.edges])

  const active = hovered ?? selected
  const isLit = (key: string) => !active || key === active || Boolean(neighbors.get(active)?.has(key))

  /** Bildschirm- in SVG-Koordinaten (vor Pan/Zoom). */
  const toSvg = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return { x: ((clientX - rect.left) / rect.width) * WIDTH, y: ((clientY - rect.top) / rect.height) * HEIGHT }
  }, [])

  const zoomAt = useCallback((factor: number, center: Point = { x: WIDTH / 2, y: HEIGHT / 2 }) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor))
      const ratio = k / current.k
      return { k, x: center.x - (center.x - current.x) * ratio, y: center.y - (center.y - current.y) * ratio }
    })
  }, [])

  // Nicht-passiver Listener, sonst lässt sich das Scrollen der Seite nicht verhindern.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.0025), toSvg(event.clientX, event.clientY))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [toSvg, zoomAt])

  const onPointerDown = (event: ReactPointerEvent, key?: string) => {
    event.stopPropagation()
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    drag.current = {
      kind: key ? 'node' : 'pan',
      key,
      startX: event.clientX,
      startY: event.clientY,
      origin: key ? position(key) : { x: view.x, y: view.y },
      moved: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current
    if (!state) return
    const start = toSvg(state.startX, state.startY)
    const now = toSvg(event.clientX, event.clientY)
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < DRAG_THRESHOLD) return
    state.moved = true
    if (state.kind === 'pan') {
      setView((current) => ({ ...current, x: state.origin.x + (now.x - start.x), y: state.origin.y + (now.y - start.y) }))
    } else if (state.key) {
      const key = state.key
      setMoved((current) => ({
        ...current,
        [key]: { x: state.origin.x + (now.x - start.x) / view.k, y: state.origin.y + (now.y - start.y) / view.k },
      }))
    }
  }

  const onPointerUp = () => {
    const state = drag.current
    drag.current = null
    if (!state || state.moved) return
    setSelected(state.kind === 'node' ? state.key ?? null : null)
  }

  const selectedNode = selected ? nodesByKey.get(selected) : null
  const selectedEdges = selected ? graph.edges.filter((edge) => edge.source === selected || edge.target === selected) : []

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card className="relative overflow-hidden p-0">
        <div className="absolute right-3 top-3 z-10 flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => zoomAt(1.25)} aria-label="Vergrößern">
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => zoomAt(0.8)} aria-label="Verkleinern">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setView(INITIAL_VIEW)
              setMoved({})
            }}
            aria-label="Ansicht zurücksetzen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-[min(70dvh,640px)] w-full cursor-grab touch-none select-none bg-[#0d0d0e] active:cursor-grabbing"
          role="img"
          aria-label={`Netzwerk mit ${graph.nodes.length} Knoten und ${graph.edges.length} Verbindungen`}
          onPointerDown={(event) => onPointerDown(event)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHovered(null)}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph.edges.map((edge) => {
              const a = position(edge.source)
              const b = position(edge.target)
              if (!a || !b) return null
              const lit = !active || edge.source === active || edge.target === active
              return (
                <g key={edge.key} opacity={lit ? 1 : 0.12}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={edge.kind === 'person-link' ? '#64d2ff' : edge.kind === 'case-link' ? '#a78bfa' : '#48484a'}
                    strokeWidth={1.2 / view.k + 0.4}
                    strokeDasharray={edge.kind === 'case-link' ? '6 4' : undefined}
                  />
                  {active && lit && edge.label && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#c7c7cc"
                      paintOrder="stroke"
                      stroke="#0d0d0e"
                      strokeWidth={3}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              )
            })}

            {graph.nodes.map((node) => {
              const point = position(node.key)
              if (!point) return null
              const isFocus = node.key === graph.focus
              const radius = isFocus ? 14 : node.kind === 'investigation' ? 10 : 8
              const alarm = node.flags.some((flag) => flag !== 'Verschlusssache')
              return (
                <g
                  key={node.key}
                  transform={`translate(${point.x} ${point.y})`}
                  opacity={isLit(node.key) ? 1 : 0.2}
                  className="cursor-pointer"
                  onPointerDown={(event) => onPointerDown(event, node.key)}
                  onPointerEnter={() => setHovered(node.key)}
                  onPointerLeave={() => setHovered(null)}
                  onDoubleClick={() => onFocus(node.key)}
                >
                  {node.key === selected && <circle r={radius + 6} fill="none" stroke="#f5f5f7" strokeWidth={1.5} />}
                  {node.kind === 'investigation' ? (
                    <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={3} fill={KIND_COLORS[node.kind]} />
                  ) : node.kind === 'vehicle' ? (
                    <polygon points={`0,${-radius} ${radius},${radius} ${-radius},${radius}`} fill={KIND_COLORS[node.kind]} />
                  ) : (
                    <circle r={radius} fill={KIND_COLORS[node.kind]} />
                  )}
                  {alarm && <circle cx={radius} cy={-radius} r={4} fill="#ff453a" stroke="#0d0d0e" strokeWidth={1.5} />}
                  <text
                    y={radius + 13}
                    textAnchor="middle"
                    fontSize={isFocus ? 12 : 10.5}
                    fontWeight={isFocus ? 600 : 400}
                    fill="#e5e5ea"
                    paintOrder="stroke"
                    stroke="#0d0d0e"
                    strokeWidth={3}
                  >
                    {shorten(node.kind === 'investigation' ? `${node.code} ${node.label}` : node.label)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#2c2c2e] px-3 py-2 text-[11.5px] text-[#98989d]">
          {(Object.keys(KIND_COLORS) as GraphNodeKind[]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLORS[kind] }} />
              {GRAPH_NODE_KIND_LABELS[kind]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff453a]" />
            Fahndung / gefährlich / gestohlen
          </span>
          <span className="ml-auto">
            {graph.nodes.length} Knoten · {graph.edges.length} Verbindungen
            {graph.truncated ? ' · gekürzt' : ''}
          </span>
        </div>
      </Card>

      <Card className="h-fit">
        {selectedNode ? (
          <div className="space-y-3">
            <div>
              <p className="text-[11.5px] text-[#8e8e93]">{GRAPH_NODE_KIND_LABELS[selectedNode.kind]}</p>
              <p className="font-mono text-[11.5px] text-[#d4d4d4]">{selectedNode.code}</p>
              <h2 className="text-[14px] font-semibold text-white">{selectedNode.label}</h2>
              {selectedNode.flags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedNode.flags.map((flag) => (
                    <span key={flag} className="rounded bg-[#7f1d1d]/40 px-1.5 text-[11px] text-[#fca5a5]">
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={nodeHref(selectedNode)}>
                <Button size="sm" variant="outline">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Öffnen
                </Button>
              </Link>
              {selectedNode.key !== graph.focus && (
                <Button size="sm" variant="ghost" onClick={() => onFocus(selectedNode.key)}>
                  <Crosshair className="h-3.5 w-3.5" />
                  Als Fokus
                </Button>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#8e8e93]">
                Verbindungen ({selectedEdges.length})
              </h3>
              <ul className="max-h-[320px] space-y-0.5 overflow-y-auto">
                {selectedEdges.map((edge) => {
                  const other = nodesByKey.get(edge.source === selectedNode.key ? edge.target : edge.source)
                  if (!other) return null
                  return (
                    <li key={edge.key}>
                      <button
                        type="button"
                        onClick={() => setSelected(other.key)}
                        className="flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left hover:bg-[#2c2c2e]"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[other.kind] }} />
                        <span className="truncate text-[12.5px] text-white">{other.label}</span>
                        {edge.label && <span className="ml-auto shrink-0 text-[11px] text-[#8e8e93]">{edge.label}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-[#8e8e93]">
            Knoten anklicken für Details. Doppelklick setzt ihn als neuen Ausgangspunkt.
          </p>
        )}
      </Card>
    </div>
  )
}

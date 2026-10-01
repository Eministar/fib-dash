/**
 * Verknüpfungsgraph: Akten, Personen und Fahrzeuge als Netzwerk. Reine Logik
 * (Aufbau mit Knotenlimit, Kräfte-Layout) – Server und Client nutzen sie.
 */

export const GRAPH_NODE_KINDS = ['investigation', 'person', 'vehicle'] as const
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number]

export const GRAPH_NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  investigation: 'Akte',
  person: 'Person',
  vehicle: 'Fahrzeug',
}

export type GraphEdgeKind = 'involved' | 'vehicle' | 'person-link' | 'case-link' | 'owner'

export const GRAPH_MAX_NODES = 150
export const GRAPH_MAX_DEPTH = 3

export interface GraphNode {
  /** `<kind>:<id>` – eindeutig über alle Arten. */
  key: string
  kind: GraphNodeKind
  id: string
  label: string
  code: string
  /** Fahndung, gefährlich, gestohlen, Verschlusssache … */
  flags: string[]
  /** Abstand zum Fokus in Schritten. */
  depth: number
}

export interface GraphEdge {
  key: string
  source: string
  target: string
  kind: GraphEdgeKind
  label: string | null
}

export interface LinkGraph {
  focus: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Knotenlimit erreicht – es gibt weitere Verbindungen. */
  truncated: boolean
}

export function nodeKey(kind: GraphNodeKind, id: string) {
  return `${kind}:${id}`
}

export function parseNodeKey(value: string | null | undefined): { kind: GraphNodeKind; id: string } | null {
  if (!value) return null
  const index = value.indexOf(':')
  if (index <= 0) return null
  const kind = value.slice(0, index)
  const id = value.slice(index + 1)
  if (!(GRAPH_NODE_KINDS as readonly string[]).includes(kind) || !id || id.length > 191) return null
  return { kind: kind as GraphNodeKind, id }
}

/**
 * Sammelt Knoten und Kanten. Kanten zu Knoten, die wegen des Limits nicht
 * aufgenommen wurden, werden verworfen – der Graph bleibt in sich konsistent.
 */
export class GraphBuilder {
  private nodes = new Map<string, GraphNode>()
  private edges = new Map<string, GraphEdge>()
  truncated = false

  constructor(readonly focus: string, private readonly maxNodes = GRAPH_MAX_NODES) {}

  has(key: string) {
    return this.nodes.has(key)
  }

  /** Liefert `true`, wenn der Knoten neu ist (und damit weiter erkundet werden soll). */
  addNode(node: GraphNode) {
    if (this.nodes.has(node.key)) return false
    if (this.nodes.size >= this.maxNodes) {
      this.truncated = true
      return false
    }
    this.nodes.set(node.key, node)
    return true
  }

  addEdge(source: string, target: string, kind: GraphEdgeKind, label: string | null = null) {
    if (source === target) return
    // Ungerichtet für die Eindeutigkeit: A–B und B–A sind dieselbe Kante.
    const [a, b] = source < target ? [source, target] : [target, source]
    const key = `${kind}:${a}|${b}|${label ?? ''}`
    if (!this.edges.has(key)) this.edges.set(key, { key, source, target, kind, label })
  }

  build(): LinkGraph {
    const edges = [...this.edges.values()].filter((edge) => this.nodes.has(edge.source) && this.nodes.has(edge.target))
    return { focus: this.focus, nodes: [...this.nodes.values()], edges, truncated: this.truncated }
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * Kräfte-Layout nach Fruchterman–Reingold. Deterministisch (Startpositionen
 * auf Ringen je Tiefe), damit derselbe Graph beim Neuladen gleich aussieht.
 * Der Fokus bleibt in der Mitte.
 */
export function layoutGraph(
  graph: Pick<LinkGraph, 'nodes' | 'edges' | 'focus'>,
  options: { width?: number; height?: number; iterations?: number } = {},
): Record<string, Point> {
  const width = options.width ?? 1000
  const height = options.height ?? 700
  const iterations = options.iterations ?? 300
  const nodes = graph.nodes
  const count = nodes.length
  const positions: Record<string, Point> = {}
  if (count === 0) return positions

  const centerX = width / 2
  const centerY = height / 2

  // Startaufstellung: Ringe nach Tiefe, gleichmäßig verteilt.
  const byDepth = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    const list = byDepth.get(node.depth) ?? []
    list.push(node)
    byDepth.set(node.depth, list)
  }
  for (const [depth, list] of byDepth) {
    list.forEach((node, index) => {
      if (node.key === graph.focus) {
        positions[node.key] = { x: centerX, y: centerY }
        return
      }
      const radius = 140 * Math.max(depth, 1)
      const angle = (2 * Math.PI * index) / list.length + depth * 0.7
      positions[node.key] = { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) }
    })
  }

  const area = width * height
  const k = Math.sqrt(area / count) * 0.75
  let temperature = width / 8
  const cooling = temperature / (iterations + 1)
  const keys = nodes.map((node) => node.key)

  for (let step = 0; step < iterations; step += 1) {
    const disp: Record<string, Point> = {}
    for (const key of keys) disp[key] = { x: 0, y: 0 }

    // Abstoßung zwischen allen Knotenpaaren.
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = positions[keys[i]]
        const b = positions[keys[j]]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distance = Math.hypot(dx, dy)
        if (distance < 0.01) {
          // Deckungsgleiche Knoten minimal auseinanderschieben.
          dx = 0.01 * (i - j)
          dy = 0.01
          distance = Math.hypot(dx, dy)
        }
        const force = (k * k) / distance
        disp[keys[i]].x += (dx / distance) * force
        disp[keys[i]].y += (dy / distance) * force
        disp[keys[j]].x -= (dx / distance) * force
        disp[keys[j]].y -= (dy / distance) * force
      }
    }

    // Anziehung entlang der Kanten.
    for (const edge of graph.edges) {
      const a = positions[edge.source]
      const b = positions[edge.target]
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distance = Math.max(Math.hypot(dx, dy), 0.01)
      const force = (distance * distance) / k
      disp[edge.source].x -= (dx / distance) * force
      disp[edge.source].y -= (dy / distance) * force
      disp[edge.target].x += (dx / distance) * force
      disp[edge.target].y += (dy / distance) * force
    }

    for (const key of keys) {
      if (key === graph.focus) continue
      const d = disp[key]
      const length = Math.max(Math.hypot(d.x, d.y), 0.01)
      const limited = Math.min(length, temperature)
      const point = positions[key]
      // Leichter Zug zur Mitte hält lose Teilgraphen im Bild.
      point.x += (d.x / length) * limited + (centerX - point.x) * 0.01
      point.y += (d.y / length) * limited + (centerY - point.y) * 0.01
      point.x = Math.min(width - 20, Math.max(20, point.x))
      point.y = Math.min(height - 20, Math.max(20, point.y))
    }
    temperature = Math.max(temperature - cooling, 0.5)
  }

  return positions
}

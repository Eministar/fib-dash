import 'server-only'

import type { CurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  INVESTIGATION_PERSON_ROLE_LABELS,
  PERSON_LINK_TYPE_LABELS,
  investigationVisibilityWhere,
} from '@/lib/investigations'
import {
  GRAPH_MAX_DEPTH,
  GraphBuilder,
  nodeKey,
  type GraphNode,
  type GraphNodeKind,
  type LinkGraph,
} from '@/lib/link-graph'

const investigationSelect = { id: true, caseNumber: true, title: true, classified: true } as const
const personSelect = {
  id: true,
  personNumber: true,
  firstName: true,
  lastName: true,
  alias: true,
  wanted: true,
  dangerous: true,
} as const
const vehicleSelect = { id: true, vehicleNumber: true, plate: true, model: true, stolen: true, wanted: true } as const

/** Obergrenze je Abfrage – schützt vor riesigen Netzen um ein „Drehkreuz“. */
const QUERY_LIMIT = 500

type InvestigationRow = { id: string; caseNumber: string; title: string; classified: boolean }
type PersonRow = {
  id: string
  personNumber: string
  firstName: string
  lastName: string
  alias: string | null
  wanted: boolean
  dangerous: boolean
}
type VehicleRow = { id: string; vehicleNumber: string; plate: string | null; model: string | null; stolen: boolean; wanted: boolean }

function investigationNode(row: InvestigationRow, depth: number): GraphNode {
  return {
    key: nodeKey('investigation', row.id),
    kind: 'investigation',
    id: row.id,
    label: row.title,
    code: row.caseNumber,
    flags: row.classified ? ['Verschlusssache'] : [],
    depth,
  }
}

function personNode(row: PersonRow, depth: number): GraphNode {
  const flags: string[] = []
  if (row.wanted) flags.push('Fahndung')
  if (row.dangerous) flags.push('Gefährlich')
  return {
    key: nodeKey('person', row.id),
    kind: 'person',
    id: row.id,
    label: `${row.firstName} ${row.lastName}${row.alias ? ` „${row.alias}“` : ''}`,
    code: row.personNumber,
    flags,
    depth,
  }
}

function vehicleNode(row: VehicleRow, depth: number): GraphNode {
  const flags: string[] = []
  if (row.stolen) flags.push('Gestohlen')
  if (row.wanted) flags.push('Fahndung')
  return {
    key: nodeKey('vehicle', row.id),
    kind: 'vehicle',
    id: row.id,
    label: [row.plate, row.model].filter(Boolean).join(' · ') || row.vehicleNumber,
    code: row.vehicleNumber,
    flags,
    depth,
  }
}

/**
 * Breitensuche ab einem Fokus. Verschlusssachen ohne Zugriff tauchen weder als
 * Knoten noch als Brücke auf – über eine geheime Akte darf man nicht zu ihren
 * Beteiligten „durchwandern“.
 *
 * Liefert `null`, wenn der Fokus nicht existiert oder nicht sichtbar ist.
 */
export async function buildLinkGraph(
  user: CurrentUser,
  focus: { kind: GraphNodeKind; id: string },
  requestedDepth: number,
): Promise<LinkGraph | null> {
  const depth = Math.min(Math.max(Math.trunc(requestedDepth) || 1, 1), GRAPH_MAX_DEPTH)
  const visible = investigationVisibilityWhere(user)
  const focusKey = nodeKey(focus.kind, focus.id)
  const graph = new GraphBuilder(focusKey)

  let start: GraphNode | null = null
  if (focus.kind === 'investigation') {
    const row = await prisma.investigation.findFirst({ where: { AND: [{ id: focus.id }, visible] }, select: investigationSelect })
    start = row && investigationNode(row, 0)
  } else if (focus.kind === 'person') {
    const row = await prisma.person.findUnique({ where: { id: focus.id }, select: personSelect })
    start = row && personNode(row, 0)
  } else {
    const row = await prisma.vehicle.findUnique({ where: { id: focus.id }, select: vehicleSelect })
    start = row && vehicleNode(row, 0)
  }
  if (!start) return null
  graph.addNode(start)

  let frontier: GraphNode[] = [start]
  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    const next: GraphNode[] = []
    const visit = (node: GraphNode) => {
      if (graph.addNode(node)) next.push(node)
    }
    const ids = (kind: GraphNodeKind) => frontier.filter((node) => node.kind === kind).map((node) => node.id)
    const investigationIds = ids('investigation')
    const personIds = ids('person')
    const vehicleIds = ids('vehicle')

    const [involvement, vehicleLinks, caseLinks, personLinks, owned] = await Promise.all([
      // Akte ↔ Person (beide Richtungen in einer Abfrage)
      investigationIds.length || personIds.length
        ? prisma.investigationPerson.findMany({
            where: {
              investigation: visible,
              OR: [
                ...(investigationIds.length ? [{ investigationId: { in: investigationIds } }] : []),
                ...(personIds.length ? [{ personId: { in: personIds } }] : []),
              ],
            },
            select: { role: true, investigation: { select: investigationSelect }, person: { select: personSelect } },
            take: QUERY_LIMIT,
          })
        : [],
      // Akte ↔ Fahrzeug
      investigationIds.length || vehicleIds.length
        ? prisma.investigationVehicle.findMany({
            where: {
              investigation: visible,
              OR: [
                ...(investigationIds.length ? [{ investigationId: { in: investigationIds } }] : []),
                ...(vehicleIds.length ? [{ vehicleId: { in: vehicleIds } }] : []),
              ],
            },
            select: { investigation: { select: investigationSelect }, vehicle: { select: vehicleSelect } },
            take: QUERY_LIMIT,
          })
        : [],
      // Akte ↔ Akte
      investigationIds.length
        ? prisma.investigationLink.findMany({
            where: {
              from: visible,
              to: visible,
              OR: [{ fromId: { in: investigationIds } }, { toId: { in: investigationIds } }],
            },
            select: { from: { select: investigationSelect }, to: { select: investigationSelect } },
            take: QUERY_LIMIT,
          })
        : [],
      // Person ↔ Person
      personIds.length
        ? prisma.personLink.findMany({
            where: { OR: [{ fromPersonId: { in: personIds } }, { toPersonId: { in: personIds } }] },
            select: { type: true, fromPerson: { select: personSelect }, toPerson: { select: personSelect } },
            take: QUERY_LIMIT,
          })
        : [],
      // Halter ↔ Fahrzeug
      personIds.length || vehicleIds.length
        ? prisma.vehicle.findMany({
            where: {
              ownerPersonId: { not: null },
              OR: [
                ...(personIds.length ? [{ ownerPersonId: { in: personIds } }] : []),
                ...(vehicleIds.length ? [{ id: { in: vehicleIds } }] : []),
              ],
            },
            select: { ...vehicleSelect, ownerPerson: { select: personSelect } },
            take: QUERY_LIMIT,
          })
        : [],
    ])

    for (const link of involvement) {
      const a = investigationNode(link.investigation, level)
      const b = personNode(link.person, level)
      visit(a)
      visit(b)
      graph.addEdge(a.key, b.key, 'involved', INVESTIGATION_PERSON_ROLE_LABELS[link.role] ?? null)
    }
    for (const link of vehicleLinks) {
      const a = investigationNode(link.investigation, level)
      const b = vehicleNode(link.vehicle, level)
      visit(a)
      visit(b)
      graph.addEdge(a.key, b.key, 'vehicle')
    }
    for (const link of caseLinks) {
      const a = investigationNode(link.from, level)
      const b = investigationNode(link.to, level)
      visit(a)
      visit(b)
      graph.addEdge(a.key, b.key, 'case-link', 'Querverweis')
    }
    for (const link of personLinks) {
      const a = personNode(link.fromPerson, level)
      const b = personNode(link.toPerson, level)
      visit(a)
      visit(b)
      graph.addEdge(a.key, b.key, 'person-link', PERSON_LINK_TYPE_LABELS[link.type] ?? null)
    }
    for (const vehicle of owned) {
      if (!vehicle.ownerPerson) continue
      const a = personNode(vehicle.ownerPerson, level)
      const b = vehicleNode(vehicle, level)
      visit(a)
      visit(b)
      graph.addEdge(a.key, b.key, 'owner', 'Halter')
    }

    frontier = next
  }

  return graph.build()
}

import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { routeError } from '@/lib/investigations-server'
import { parseNodeKey } from '@/lib/link-graph'
import { buildLinkGraph } from '@/lib/link-graph-server'

export const dynamic = 'force-dynamic'

/** Netzwerk um `focus=<investigation|person|vehicle>:<id>`, `depth` 1–3 Schritte. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const focus = parseNodeKey(req.nextUrl.searchParams.get('focus'))
    if (!focus) return error('Ungültiger Fokus')

    const depth = Number.parseInt(req.nextUrl.searchParams.get('depth') ?? '2', 10)
    const graph = await buildLinkGraph(user, focus, depth)
    if (!graph) return notFound('Ausgangspunkt')
    return success(graph)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

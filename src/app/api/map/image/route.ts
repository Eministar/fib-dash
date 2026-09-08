import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { requirePermission } from '@/lib/auth'
import { mapRouteError } from '@/lib/map-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAP_FILE = path.join(process.cwd(), 'src', 'assets', 'map.png')

export async function GET(req: Request) {
  try {
    await requirePermission('map:view')

    const info = await stat(MAP_FILE)
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`
    const headers = {
      // Das Kartenbild ändert sich nur beim Deployment (neue mtime → neues
      // ETag). Bei 21 MB lohnt sich `immutable`: der Browser fragt danach ein
      // Jahr lang nicht mehr nach, nur die kleinen Punktdaten werden neu geladen.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Type': 'image/png',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }

    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }

    const image = await readFile(MAP_FILE)
    return new Response(new Uint8Array(image), {
      headers: { ...headers, 'Content-Length': String(image.byteLength) },
    })
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}

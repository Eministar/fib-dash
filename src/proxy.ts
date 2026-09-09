import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Public-API-CORS:
 *
 * Erlaubt Browser-Calls von beliebigen Origins auf /api/*.
 *
 * **Sicherheit:** Wir setzen bewusst KEINE Allowlist. Da API-Endpoints
 * ausschließlich über Bearer-Tokens (`Authorization: Bearer fib_…`) oder
 * Session-Cookies authentifiziert werden, ist der Origin kein
 * vertrauenswürdiger Kontext. Wer ein gültiges Token hat, darf von überall
 * aus zugreifen — genau wie bei GitHub-PATs, Stripe-Keys etc.
 *
 * Bei Cookie-Authentifizierung greift der Same-Origin-Schutz des Browsers
 * weiterhin (`Access-Control-Allow-Credentials: true` + reflektierter Origin
 * verhindert fremde Origins vom Mitlesen der Session).
 */
function applyCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin')
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Vary', 'Origin')
    res.headers.set('Access-Control-Allow-Credentials', 'true')
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    res.headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Requested-With, X-Idempotency-Key, X-Discord-Id',
    )
    res.headers.set(
      'Access-Control-Expose-Headers',
      'X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, X-Request-Id',
    )
    res.headers.set('Access-Control-Max-Age', '600')
  }
  return res
}

export function proxy(req: NextRequest) {
  // Nur API-Routen — Dashboard-Routen sind same-origin und brauchen kein CORS.
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  if (req.method === 'OPTIONS') {
    return applyCors(req, new NextResponse(null, { status: 204 }))
  }

  const res = NextResponse.next()
  applyCors(req, res)
  return res
}

export const config = {
  // Binary uploads must reach their streaming handlers without Next cloning
  // and truncating their bodies at the proxy's default 10 MB buffer limit.
  //
  // Die beiden Rohbody-Routen stehen hier nur noch uebergangsweise: sie fallen
  // weg, sobald alle Uploads ueber /api/uploads/:id/chunks/:index laufen. Bis
  // dahin muessen sie ausgenommen bleiben, sonst bricht ein grosser Upload
  // zwischen zwei Commits.
  matcher: '/api/((?!uploads/[^/]+/chunks/|investigations/clips/?$|corruption-checks/[^/]+/evidence/?$).*)',
}

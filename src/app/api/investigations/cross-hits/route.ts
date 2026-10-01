import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { findPersonCrossHits, findVehicleCrossHits } from '@/lib/cross-hits-server'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

const param = (req: NextRequest, name: string) => (req.nextUrl.searchParams.get(name) ?? '').slice(0, 120)

/**
 * Bereits erfasste Personen bzw. Fahrzeuge zu den Eingaben eines Formulars,
 * jeweils mit den (für den Nutzer sichtbaren) Akten, in denen sie vorkommen.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')

    const plate = param(req, 'plate')
    if (plate) {
      return success(await findVehicleCrossHits(user, plate, param(req, 'excludeVehicleId') || null))
    }

    const hits = await findPersonCrossHits(
      user,
      {
        firstName: param(req, 'firstName'),
        lastName: param(req, 'lastName'),
        alias: param(req, 'alias'),
        identifier: param(req, 'identifier'),
        phone: param(req, 'phone'),
      },
      param(req, 'excludePersonId') || null,
    )
    return success(hits)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

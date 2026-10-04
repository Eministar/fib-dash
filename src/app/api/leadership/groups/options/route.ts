import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { dossierRouteError } from '@/lib/dossiers-server'

/**
 * Nur Namen und IDs, damit Aktenverwalter eine Gruppe an Dauerakten hängen
 * können. Mitglieder, Familien, Kanäle und Leitungen bleiben vertraulich.
 */
export async function GET() {
  try {
    await requirePermission('investigations:manage')
    const groups = await prisma.leadershipGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    const response = success(groups)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (cause) { return dossierRouteError(cause) }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { changeAgentLicense, getAgentLicenses, LicenseError } from '@/lib/licenses/licenses-server'

function authError(e: unknown) {
  if (e instanceof LicenseError) return error(e.message)
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('agents:view')
    const { id } = await params
    if (!(await prisma.agent.findUnique({ where: { id }, select: { id: true } }))) return notFound('Agent')
    return success(await getAgentLicenses(id))
  } catch (e: unknown) {
    return authError(e)
  }
}

/** Body: `{ licenseId, action: 'grant' | 'revoke', reason?, sanctionId?, overrideCooldown? }` */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN'], ['licenses:manage'])
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body.licenseId !== 'string' || (body.action !== 'grant' && body.action !== 'revoke')) {
      return error('Ungültige Daten')
    }
    await changeAgentLicense({
      agentId: id,
      licenseId: body.licenseId,
      action: body.action,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 2000) : null,
      sanctionId: typeof body.sanctionId === 'string' && body.sanctionId ? body.sanctionId : null,
      overrideCooldown: body.overrideCooldown === true,
      actor: user,
    })
    return success(await getAgentLicenses(id))
  } catch (e: unknown) {
    return authError(e)
  }
}

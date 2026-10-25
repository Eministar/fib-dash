import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { parseLicenseInput } from '@/lib/licenses/licenses'

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

/** Lizenzarten mit Anzahl erteilter und entzogener Lizenzen (nur Agents im Dienst). */
export async function GET() {
  try {
    await requirePermission('agents:view')
  } catch (e: unknown) {
    return authError(e)
  }

  const [licenses, counts] = await Promise.all([
    prisma.license.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    prisma.agentLicense.groupBy({
      by: ['licenseId', 'status'],
      where: { agent: { status: { not: 'TERMINATED' } } },
      _count: { _all: true },
    }),
  ])
  const count = (licenseId: string, status: 'GRANTED' | 'REVOKED') =>
    counts.find((row) => row.licenseId === licenseId && row.status === status)?._count._all ?? 0
  return success(licenses.map((license) => ({ ...license, granted: count(license.id, 'GRANTED'), revoked: count(license.id, 'REVOKED') })))
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['licenses:manage'])
    const input = parseLicenseInput(await req.json().catch(() => null))
    if (typeof input === 'string') return error(input)
    if (await prisma.license.findUnique({ where: { key: input.key } })) return error('Key ist bereits vergeben')
    return success(await prisma.license.create({ data: input }), 201)
  } catch (e: unknown) {
    return authError(e)
  }
}

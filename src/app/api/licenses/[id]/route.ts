import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { parseLicenseInput } from '@/lib/licenses/licenses'

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['licenses:manage'])
    const { id } = await params
    const input = parseLicenseInput(await req.json().catch(() => null))
    if (typeof input === 'string') return error(input)
    if (!(await prisma.license.findUnique({ where: { id } }))) return notFound('Lizenz')
    const clash = await prisma.license.findUnique({ where: { key: input.key } })
    if (clash && clash.id !== id) return error('Key ist bereits vergeben')
    return success(await prisma.license.update({ where: { id }, data: input }))
  } catch (e: unknown) {
    return authError(e)
  }
}

/** Nur unbenutzte Lizenzarten lassen sich löschen – sonst ginge die Historie verloren. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['licenses:manage'])
    const { id } = await params
    const used = await prisma.agentLicenseEvent.count({ where: { licenseId: id } })
    if (used > 0) return error('Diese Lizenz wurde schon vergeben – bitte deaktivieren statt löschen, damit die Historie erhalten bleibt')
    await prisma.license.delete({ where: { id } })
    return success({ message: 'Lizenz gelöscht' })
  } catch (e: unknown) {
    return authError(e)
  }
}

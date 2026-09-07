import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const folder = await prisma.sruFolder.findUnique({ where: { id } })
    if (!folder) return notFound('Ordner')
    await requireTaskModuleManage(folder.module)

    await prisma.sruFolder.delete({ where: { id } })
    return success({ message: 'Ordner gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

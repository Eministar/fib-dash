import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'
import { deleteUploadedFile } from '@/lib/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireTaskModuleManage('ACADEMY')
    const { id } = await params
    const resource = await prisma.academyResource.findUnique({ where: { id } })
    if (!resource) return notFound('Ressource')

    await prisma.academyResource.delete({ where: { id } })
    if (resource.storedFilename) {
      await deleteUploadedFile(resource.storedFilename).catch((uploadError) => {
        console.error('[AcademyResources] Datei konnte nicht gelöscht werden:', uploadError)
      })
    }

    return success({ message: 'Ressource gelöscht' })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

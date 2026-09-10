import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { notFound } from '@/lib/api-response'
import { fileUploadResponse } from '@/lib/file-uploads'
import { fileUploadRouteError } from '@/lib/file-upload-queries'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * Liefert den Dateiinhalt aus — nur an angemeldete Nutzer mit Leserecht.
 * Die Sicherheits-Header für fremdes HTML setzt `fileUploadResponse`.
 */
export async function GET(req: NextRequest, { params }: Context) {
  try {
    await requireAuth(undefined, ['uploads:view', 'uploads:manage'])
    const { id } = await params
    const upload = await prisma.fileUpload.findUnique({
      where: { id },
      select: { filename: true, mimeType: true, originalName: true },
    })
    if (!upload) return notFound('Upload')
    return await fileUploadResponse(upload, req.headers.get('range'))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return notFound('Datei')
    return fileUploadRouteError(cause)
  }
}

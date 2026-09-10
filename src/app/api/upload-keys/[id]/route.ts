import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { fileUploadRouteError } from '@/lib/file-upload-queries'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    defaultCategory: z.string().trim().max(100).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    /** Widerruf ist bewusst einseitig: einmal widerrufen bleibt widerrufen. */
    revoke: z.boolean().optional(),
    revokedReason: z.string().trim().max(500).optional(),
  })
  .strict()

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await requireAuth(undefined, ['uploads:manage'])
    const { id } = await params
    const input = patchSchema.parse(await req.json())
    const existing = await prisma.uploadKey.findUnique({ where: { id }, select: { id: true, name: true, revokedAt: true } })
    if (!existing) return notFound('Upload-Schlüssel')

    const key = await prisma.uploadKey.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.defaultCategory !== undefined ? { defaultCategory: input.defaultCategory } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
        ...(input.revoke && !existing.revokedAt
          ? { revokedAt: new Date(), revokedReason: input.revokedReason ?? null }
          : {}),
      },
      select: { id: true, name: true, revokedAt: true },
    })
    await createAuditLog({
      action: input.revoke ? 'UPLOAD_KEY_REVOKED' : 'UPLOAD_KEY_UPDATED',
      userId: user.id,
      details: `${key.name} (${id})`,
    })
    return success(key)
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

/**
 * Löscht den Schlüssel endgültig. Bereits hochgeladene Dateien bleiben
 * erhalten und verlieren nur ihren Herkunftsverweis.
 */
export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requireAuth(undefined, ['uploads:manage'])
    const { id } = await params
    const key = await prisma.uploadKey.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!key) return notFound('Upload-Schlüssel')
    await prisma.uploadKey.delete({ where: { id } })
    await createAuditLog({ action: 'UPLOAD_KEY_DELETED', userId: user.id, details: `${key.name} (${id})` })
    return success({ deleted: true })
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

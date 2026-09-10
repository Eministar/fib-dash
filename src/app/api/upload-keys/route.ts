import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { generateUploadKey } from '@/lib/upload-keys'
import { fileUploadRouteError } from '@/lib/file-upload-queries'

export const dynamic = 'force-dynamic'

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(2000).optional(),
    defaultCategory: z.string().trim().max(100).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()

const keySelect = {
  id: true,
  name: true,
  prefix: true,
  description: true,
  defaultCategory: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  lastUsedAt: true,
  usageCount: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
  _count: { select: { uploads: true } },
}

export async function GET() {
  try {
    await requireAuth(undefined, ['uploads:manage'])
    const keys = await prisma.uploadKey.findMany({ select: keySelect, orderBy: { createdAt: 'desc' } })
    return success({ keys })
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

/**
 * Legt einen Schlüssel an. Der Klartext wird genau einmal zurückgegeben —
 * danach existiert nur noch sein Hash.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(undefined, ['uploads:manage'])
    const input = createSchema.parse(await req.json())
    const generated = generateUploadKey()

    const key = await prisma.uploadKey.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        defaultCategory: input.defaultCategory ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        createdById: user.id,
      },
      select: keySelect,
    })
    await createAuditLog({ action: 'UPLOAD_KEY_CREATED', userId: user.id, details: `${key.name} (${key.prefix})` })
    return success({ key, plaintext: generated.plaintext }, 201)
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

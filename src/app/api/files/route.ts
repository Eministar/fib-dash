import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { getFileUploadMaxBytes } from '@/lib/settings-helpers'
import {
  FileUploadError,
  deleteStoredFile,
  metaFromFormData,
  storeUploadedFile,
} from '@/lib/file-uploads'
import { authenticateUploadKey, extractUploadKey, recordUploadKeyUsage } from '@/lib/upload-keys'
import { fileUploadRouteError, fileUploadSelect, serializeUpload, uploadListWhere } from '@/lib/file-upload-queries'

export const dynamic = 'force-dynamic'

const listQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  category: z.string().trim().max(100).default(''),
  tag: z.string().trim().max(50).default(''),
  from: z.string().trim().max(40).default(''),
  to: z.string().trim().max(40).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})

const PAGE_SIZE = 24

/** Übersicht für das Dashboard. Nur mit Session — nie mit Upload-Schlüssel. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(undefined, ['uploads:view', 'uploads:manage'])
    const q = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = uploadListWhere(q)
    const [items, total, categories] = await Promise.all([
      prisma.fileUpload.findMany({
        where,
        select: fileUploadSelect,
        orderBy: { createdAt: 'desc' },
        take: PAGE_SIZE,
        skip: (q.page - 1) * PAGE_SIZE,
      }),
      prisma.fileUpload.count({ where }),
      prisma.fileUpload.findMany({
        where: { category: { not: null } },
        select: { category: true },
        distinct: ['category'],
        take: 100,
      }),
    ])
    return success({
      items: items.map(serializeUpload),
      total,
      page: q.page,
      pageSize: PAGE_SIZE,
      categories: categories.map((row) => row.category).filter((value): value is string => !!value).sort(),
    })
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

/**
 * Nimmt eine Datei entgegen.
 *
 * Zwei Wege in denselben Code: ein externes System schickt einen
 * Upload-Schlüssel im Header, ein angemeldeter Nutzer lädt aus dem Dashboard
 * hoch. Wer per Schlüssel kommt, braucht keinen Account.
 */
export async function POST(req: NextRequest) {
  let stored: string | undefined
  try {
    // Nur wenn wirklich ein Upload-Schlüssel mitkommt, wird der Key-Weg
    // genommen — sonst würde ein normaler API-Token-Header hier mit 401
    // abgewiesen, statt die Session zu prüfen.
    const key = extractUploadKey(req.headers) ? await authenticateUploadKey(req.headers) : null
    const user = key ? null : await requireAuth(undefined, ['uploads:view', 'uploads:manage'])

    const form = await req.formData().catch(() => {
      throw new FileUploadError('Der Request muss multipart/form-data mit einem Feld "file" sein', 400)
    })
    const file = form.get('file')
    if (!(file instanceof File)) throw new FileUploadError('Es fehlt das Datei-Feld "file"', 400)

    const meta = metaFromFormData(form)
    const result = await storeUploadedFile(file, await getFileUploadMaxBytes())
    stored = result.filename

    const duplicate = await prisma.fileUpload.findFirst({
      where: { sha256: result.sha256 },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    })

    const upload = await prisma.fileUpload.create({
      data: {
        title: meta.title || file.name?.trim() || 'Unbenannter Upload',
        description: meta.description ?? null,
        category: meta.category ?? key?.defaultCategory ?? null,
        tags: meta.tags ?? [],
        externalRef: meta.externalRef ?? null,
        externalUrl: meta.externalUrl ?? null,
        externalUser: meta.externalUser ?? null,
        metadata: (meta.metadata ?? {}) as object,
        filename: result.filename,
        originalName: file.name?.trim() || result.filename,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        uploadKeyId: key?.id ?? null,
        uploadedById: user?.id ?? null,
      },
      select: fileUploadSelect,
    })
    stored = undefined

    if (key) await recordUploadKeyUsage(key.id, key.lastUsedAt)
    await createAuditLog({
      action: 'FILE_UPLOAD_CREATED',
      userId: user?.id ?? null,
      details: `${upload.title} (${result.mimeType}, ${result.sizeBytes} Bytes)${key ? ` · via Upload-Schlüssel "${key.name}"` : ''}`,
    })

    return success(
      { ...serializeUpload(upload), duplicateOf: duplicate && duplicate.id !== upload.id ? duplicate : null },
      201,
    )
  } catch (cause) {
    if (stored) await deleteStoredFile(stored)
    return fileUploadRouteError(cause)
  }
}


import type { Prisma } from '@/generated/prisma'
import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { FileUploadError } from './file-uploads'
import { UploadKeyError } from './upload-keys'

/**
 * Gemeinsame Abfrage-Bausteine der Upload-Routen. Liegt in `lib`, weil eine
 * Next-Route-Datei nur GET/POST/… exportieren darf.
 */

export const fileUploadSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  tags: true,
  externalRef: true,
  externalUrl: true,
  externalUser: true,
  metadata: true,
  filename: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  createdAt: true,
  updatedAt: true,
  uploadKey: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.FileUploadSelect

type SelectedUpload = Prisma.FileUploadGetPayload<{ select: typeof fileUploadSelect }>

/** Normalisiert die JSON-Spalten, damit der Client nie `unknown` sieht. */
export function serializeUpload(upload: SelectedUpload) {
  return {
    ...upload,
    tags: Array.isArray(upload.tags) ? (upload.tags as unknown[]).map(String) : [],
    metadata:
      upload.metadata && typeof upload.metadata === 'object' && !Array.isArray(upload.metadata)
        ? (upload.metadata as Record<string, unknown>)
        : {},
    viewUrl: `/api/files/${upload.id}/raw`,
  }
}

export interface UploadListQuery {
  search: string
  category: string
  tag: string
  from: string
  to: string
}

/**
 * Filter der Upload-Liste.
 *
 * Ein leerer Suchbegriff darf kein `OR` erzeugen: ein leerer Zweig in einem
 * `OR` matcht in Prisma nichts, die Liste käme dann immer leer zurück.
 */
export function uploadListWhere(q: UploadListQuery): Prisma.FileUploadWhereInput {
  const search = q.search.trim()
  const from = q.from ? new Date(q.from) : null
  const to = q.to ? new Date(q.to) : null

  return {
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } },
            { originalName: { contains: search } },
            { externalRef: { contains: search } },
            { externalUser: { contains: search } },
          ],
        }
      : {}),
    ...(q.category.trim() ? { category: q.category.trim() } : {}),
    ...(q.tag.trim() ? { tags: { array_contains: q.tag.trim() } } : {}),
    ...(from && !Number.isNaN(from.getTime()) ? { createdAt: { gte: from } } : {}),
    ...(to && !Number.isNaN(to.getTime())
      ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), lt: to } }
      : {}),
  }
}

export function fileUploadRouteError(cause: unknown) {
  if (cause instanceof UploadKeyError) return error(cause.message, cause.status)
  if (cause instanceof FileUploadError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join('; '), 400)
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe', 400)
  console.error('[FileUploads]', cause)
  return error('Upload konnte nicht verarbeitet werden', 500)
}

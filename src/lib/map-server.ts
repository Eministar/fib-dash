import { z } from 'zod'

import { Prisma } from '@/generated/prisma'
import { error, forbidden, unauthorized } from './api-response'
import { MAP_CATEGORY_IDS, MAP_SPOT_LIMITS, type MapCategory, type MapSpot } from './map-spots'

export const spotInclude = {
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.MapSpotInclude

type SpotRow = Prisma.MapSpotGetPayload<{ include: typeof spotInclude }>

const position = z.number().finite().min(0).max(100)

/** Emoji-Feld: leerer String bedeutet „kein Icon“, nicht „unverändert“. */
const icon = z
  .string()
  .trim()
  .max(MAP_SPOT_LIMITS.icon)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))

export const createSpotSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich').max(MAP_SPOT_LIMITS.title),
    description: z.string().trim().max(MAP_SPOT_LIMITS.description).default(''),
    category: z.enum(MAP_CATEGORY_IDS),
    icon,
    x: position,
    y: position,
  })
  .strict()

/** Verschieben und Bearbeiten teilen sich eine Route – alle Felder optional. */
export const updateSpotSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich').max(MAP_SPOT_LIMITS.title).optional(),
    description: z.string().trim().max(MAP_SPOT_LIMITS.description).optional(),
    category: z.enum(MAP_CATEGORY_IDS).optional(),
    icon,
    x: position.optional(),
    y: position.optional(),
  })
  .strict()

export function serializeSpot(spot: SpotRow): MapSpot {
  return {
    id: spot.id,
    title: spot.title,
    description: spot.description,
    category: spot.category as MapCategory,
    icon: spot.icon,
    x: spot.x,
    y: spot.y,
    createdById: spot.createdById,
    // Gelöschte Benutzer setzen `createdById` auf NULL – die Markierung bleibt.
    createdByName: spot.createdBy?.displayName ?? 'Unbekannt',
    createdAt: spot.createdAt.toISOString(),
    updatedAt: spot.updatedAt.toISOString(),
  }
}

export function mapRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültiges JSON')
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2025') {
    return error('Markierung nicht gefunden', 404)
  }
  console.error('[Karte]', cause)
  return error('Aktion konnte nicht abgeschlossen werden', 500)
}

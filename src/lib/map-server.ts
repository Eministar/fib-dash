import { z } from 'zod'

import { Prisma } from '@/generated/prisma'
import { error, forbidden, unauthorized } from './api-response'
import type { CurrentUser } from './auth'
import { investigationVisibilityWhere } from './investigations'
import { MAP_CATEGORY_IDS, MAP_SPOT_LIMITS, type MapCategory, type MapSpot } from './map-spots'

export const spotInclude = {
  createdBy: { select: { id: true, displayName: true } },
  dossiers: { select: { id: true, title: true, kind: true }, orderBy: { title: 'asc' } },
  investigations: { select: { id: true, caseNumber: true, title: true, classified: true }, orderBy: { caseNumber: 'asc' } },
  observations: {
    select: { id: true, note: true, observedAt: true, createdBy: { select: { displayName: true } } },
    orderBy: { observedAt: 'desc' },
  },
} satisfies Prisma.MapSpotInclude

/**
 * Wie `spotInclude`, aber Verschlusssachen bleiben für Unbefugte weg. Der
 * Punkt selbst bleibt sichtbar: verschwände er, verriete genau dieses
 * Verschwinden die geheime Verknüpfung.
 */
export function visibleSpotInclude(user: CurrentUser) {
  return {
    ...spotInclude,
    investigations: { ...spotInclude.investigations, where: investigationVisibilityWhere(user) },
  }
}

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

export const observationSchema = z
  .object({
    note: z.string().trim().min(1, 'Beobachtung ist erforderlich').max(MAP_SPOT_LIMITS.observation),
    observedAt: z.coerce.date(),
  })
  .strict()

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
    // `?? []` deckt POST und PATCH ab, die ohne die Relationen laden können.
    dossiers: spot.dossiers?.map((entry) => ({ id: entry.id, title: entry.title, kind: entry.kind })) ?? [],
    investigations: spot.investigations?.map((entry) => ({ id: entry.id, caseNumber: entry.caseNumber, title: entry.title, classified: entry.classified })) ?? [],
    observations: spot.observations?.map((entry) => ({
      id: entry.id,
      note: entry.note,
      observedAt: entry.observedAt.toISOString(),
      createdByName: entry.createdBy?.displayName ?? 'Unbekannt',
    })) ?? [],
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

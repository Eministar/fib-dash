import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'
import { mapCategory } from '@/lib/map-spots'
import { SEARCH_LIMIT_PER_GROUP, SEARCH_MIN_LENGTH, excerpt, type SearchHit } from '@/lib/global-search'

export const dynamic = 'force-dynamic'

/**
 * Bereichsübergreifende Suche. Jede Gruppe wird einzeln begrenzt, damit ein
 * häufiger Begriff in der Chronologie nicht alle anderen Treffer verdrängt.
 *
 * Verschlusssachen laufen durch `investigationVisibilityWhere`; das gilt auch
 * für Chronologie-Einträge, die sonst den Inhalt einer geheimen Akte
 * durchscheinen ließen.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const term = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (term.length < SEARCH_MIN_LENGTH) return success<SearchHit[]>([])

    const take = SEARCH_LIMIT_PER_GROUP
    const visible = investigationVisibilityWhere(user)
    const canSeeMap = hasPermission(user, 'map:view')

    const [investigations, dossiers, persons, vehicles, entries, mapSpots] = await Promise.all([
      prisma.investigation.findMany({
        where: {
          AND: [
            visible,
            { OR: [{ title: { contains: term } }, { caseNumber: { contains: term } }, { summary: { contains: term } }] },
          ],
        },
        select: { id: true, caseNumber: true, title: true, summary: true, classified: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      prisma.dossier.findMany({
        where: { OR: [{ title: { contains: term } }, { address: { contains: term } }, { description: { contains: term } }] },
        select: { id: true, title: true, kind: true, address: true, description: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      prisma.person.findMany({
        where: {
          OR: [
            { firstName: { contains: term } },
            { lastName: { contains: term } },
            { alias: { contains: term } },
            { personNumber: { contains: term } },
            { identifier: { contains: term } },
          ],
        },
        select: { id: true, personNumber: true, firstName: true, lastName: true, alias: true },
        orderBy: { lastName: 'asc' },
        take,
      }),
      prisma.vehicle.findMany({
        where: {
          OR: [
            { plate: { contains: term } },
            { model: { contains: term } },
            { vehicleNumber: { contains: term } },
            { color: { contains: term } },
          ],
        },
        select: { id: true, vehicleNumber: true, plate: true, model: true, color: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      prisma.investigationEntry.findMany({
        where: {
          AND: [
            { investigation: visible },
            { OR: [{ title: { contains: term } }, { content: { contains: term } }, { location: { contains: term } }] },
          ],
        },
        select: {
          id: true,
          title: true,
          content: true,
          investigationId: true,
          investigation: { select: { caseNumber: true, classified: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take,
      }),
      canSeeMap
        ? prisma.mapSpot.findMany({
            where: { OR: [{ title: { contains: term } }, { description: { contains: term } }] },
            select: { id: true, title: true, category: true, description: true },
            orderBy: { updatedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
    ])

    const hits: SearchHit[] = [
      ...investigations.map((row) => ({
        id: row.id,
        group: 'investigations' as const,
        code: row.caseNumber,
        title: row.title,
        hint: excerpt(row.summary, term),
        href: `/investigations/${row.id}`,
        classified: row.classified,
      })),
      ...dossiers.map((row) => ({
        id: row.id,
        group: 'dossiers' as const,
        code: row.address ?? undefined,
        title: row.title,
        hint: excerpt(row.description, term),
        href: `/investigations/dossiers?id=${encodeURIComponent(row.id)}`,
      })),
      ...persons.map((row) => ({
        id: row.id,
        group: 'persons' as const,
        code: row.personNumber,
        title: `${row.firstName} ${row.lastName}`,
        hint: row.alias ? `Alias „${row.alias}“` : undefined,
        href: `/investigations/persons?person=${encodeURIComponent(row.id)}`,
      })),
      ...vehicles.map((row) => ({
        id: row.id,
        group: 'vehicles' as const,
        code: row.plate ?? row.vehicleNumber,
        title: row.model || row.vehicleNumber,
        hint: row.color ?? undefined,
        href: '/investigations/vehicles',
      })),
      ...mapSpots.map((row) => ({
        id: row.id,
        group: 'mapSpots' as const,
        code: mapCategory(row.category).label,
        title: row.title,
        hint: excerpt(row.description, term),
        href: '/map',
      })),
      ...entries.map((row) => ({
        id: row.id,
        group: 'entries' as const,
        code: row.investigation.caseNumber,
        title: row.title,
        hint: excerpt(row.content, term),
        href: `/investigations/${row.investigationId}?tab=chronologie`,
        classified: row.investigation.classified,
      })),
    ]

    return success(hits)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

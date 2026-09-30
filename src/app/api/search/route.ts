import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'
import { mapCategory } from '@/lib/map-spots'
import { SEARCH_LIMIT_PER_GROUP, excerpt, isSearchable, type SearchHit } from '@/lib/global-search'
import { agentMatchScore, matchesAgent, tokenizedWhere } from '@/lib/search-match'
import { displayBadgeNumber } from '@/lib/badge-number'

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
    // Jeder Angemeldete darf suchen; welche Gruppen er sieht, entscheiden seine Rechte.
    const user = await requireAuth()
    const term = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (!isSearchable(term)) return success<SearchHit[]>([])

    const take = SEARCH_LIMIT_PER_GROUP
    const canSeeInvestigations = hasPermission(user, 'investigations:view')
    const canSeeAgents = hasPermission(user, 'agents:view')
    const visible = investigationVisibilityWhere(user)
    const canSeeMap = hasPermission(user, 'map:view')
    // Jedes Suchwort muss in irgendeinem Feld stehen („Max Mustermann“, „Vinewood Bank“).
    const words = <T,>(fields: (token: string) => T[]) => tokenizedWhere(term, fields) ?? {}
    const none = <T,>() => Promise.resolve([] as T[])

    const [agents, investigations, dossiers, persons, vehicles, entries, mapSpots] = await Promise.all([
      // Agents sind wenige – geladen wird alles, gefiltert mit derselben Logik
      // wie in der Agent-Liste (Dienstnummer ohne Präfix, Discord-ID am Konto …).
      canSeeAgents
        ? prisma.agent.findMany({
            select: {
              id: true,
              firstName: true,
              lastName: true,
              badgeNumber: true,
              discordId: true,
              status: true,
              rank: { select: { name: true } },
              user: { select: { discordId: true, displayName: true } },
              codename: { select: { name: true } },
            },
          })
        : none<never>(),
      !canSeeInvestigations ? none<never>() : prisma.investigation.findMany({
        where: {
          AND: [
            visible,
            words((token) => [{ title: { contains: token } }, { caseNumber: { contains: token } }, { summary: { contains: token } }]),
          ],
        },
        select: { id: true, caseNumber: true, title: true, summary: true, classified: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      !canSeeInvestigations ? none<never>() : prisma.dossier.findMany({
        where: words((token) => [{ title: { contains: token } }, { address: { contains: token } }, { description: { contains: token } }]),
        select: { id: true, title: true, kind: true, address: true, description: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      !canSeeInvestigations ? none<never>() : prisma.person.findMany({
        where: words((token) => [
          { firstName: { contains: token } },
          { lastName: { contains: token } },
          { alias: { contains: token } },
          { personNumber: { contains: token } },
          { identifier: { contains: token } },
        ]),
        select: { id: true, personNumber: true, firstName: true, lastName: true, alias: true },
        orderBy: { lastName: 'asc' },
        take,
      }),
      !canSeeInvestigations ? none<never>() : prisma.vehicle.findMany({
        where: words((token) => [
          { plate: { contains: token } },
          { model: { contains: token } },
          { vehicleNumber: { contains: token } },
          { color: { contains: token } },
        ]),
        select: { id: true, vehicleNumber: true, plate: true, model: true, color: true },
        orderBy: { updatedAt: 'desc' },
        take,
      }),
      !canSeeInvestigations ? none<never>() : prisma.investigationEntry.findMany({
        where: {
          AND: [
            { investigation: visible },
            words((token) => [{ title: { contains: token } }, { content: { contains: token } }, { location: { contains: token } }]),
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
      canSeeMap && canSeeInvestigations
        ? prisma.mapSpot.findMany({
            where: words((token) => [{ title: { contains: token } }, { description: { contains: token } }]),
            select: { id: true, title: true, category: true, description: true },
            orderBy: { updatedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
    ])

    const agentHits = agents
      .filter((agent) => matchesAgent(term, agent))
      .map((agent, index) => ({
        agent,
        index,
        // Ausgeschiedene nach hinten, sonst nach Relevanz.
        score: agentMatchScore(term, agent) - (agent.status === 'TERMINATED' ? 1000 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, take)
      .map(({ agent }) => agent)

    const hits: SearchHit[] = [
      ...agentHits.map((agent) => ({
        id: agent.id,
        group: 'agents' as const,
        code: `#${displayBadgeNumber(agent.badgeNumber)}`,
        title: `${agent.firstName} ${agent.lastName}`,
        hint: [agent.rank?.name, agent.codename?.name ? `„${agent.codename.name}“` : null, agent.status === 'TERMINATED' ? 'ausgeschieden' : null]
          .filter(Boolean)
          .join(' · ') || undefined,
        href: `/agents/${agent.id}`,
      })),
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

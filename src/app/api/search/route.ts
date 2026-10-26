import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations/investigations'
import { routeError } from '@/lib/investigations/investigations-server'
import { mapCategory } from '@/lib/investigations/map-spots'
import { SEARCH_LIMIT_PER_GROUP, excerpt, isSearchable, type SearchHit } from '@/lib/core/global-search'
import { agentMatchScore, matchesAgent, tokenizedWhere } from '@/lib/core/search-match'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { PENAL_GRADE_RULES, SANCTION_VIOLATIONS } from '@/lib/sanctions/sanction-catalog'

export const dynamic = 'force-dynamic'

/**
 * Bereichsübergreifende Suche. Jede Gruppe wird einzeln begrenzt, damit ein
 * häufiger Begriff in der Chronologie nicht alle anderen Treffer verdrängt.
 *
 * Akten und Chronologie-Einträge laufen durch `investigationVisibilityWhere`.
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
        select: { id: true, caseNumber: true, title: true, summary: true },
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
          investigation: { select: { caseNumber: true } },
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

    // Sanktionskatalog und Ordnungen darf jeder Angemeldete lesen (wie ihre eigenen Seiten).
    const searchWords = term.toLowerCase().split(/\s+/).filter(Boolean)
    const sanctionHits = SANCTION_VIOLATIONS.filter((violation) => {
      const haystack = `${violation.label} ${violation.code} pg ${violation.grade} ${PENAL_GRADE_RULES[violation.grade].severity}`.toLowerCase()
      return searchWords.every((word) => haystack.includes(word))
    }).slice(0, take)
    const ordnungen = await prisma.ordnung.findMany({
      where: words((token) => [{ title: { contains: token } }, { description: { contains: token } }, { content: { contains: token } }]),
      select: { id: true, slug: true, title: true, description: true, content: true, category: { select: { label: true } } },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      take,
    })

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
        href: `/investigations/vehicles?vehicle=${encodeURIComponent(row.id)}`,
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
      })),
      ...sanctionHits.map((violation) => {
        const rule = PENAL_GRADE_RULES[violation.grade]
        return {
          id: violation.code,
          group: 'sanctions' as const,
          code: `Penal Grade ${violation.grade}`,
          title: violation.label,
          hint: `${rule.severity} · Regelfolge: ${rule.typicalConsequence}`,
          href: '/sanktionen/katalog',
        }
      }),
      ...ordnungen.map((row) => ({
        id: row.id,
        group: 'ordnungen' as const,
        code: row.category.label,
        title: row.title,
        hint: excerpt(row.content, term) ?? excerpt(row.description, term),
        href: `/ordnungen/${row.slug}`,
      })),
    ]

    return success(hits)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

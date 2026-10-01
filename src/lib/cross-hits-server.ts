import 'server-only'

import type { CurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import type { Prisma } from '@/generated/prisma'
import {
  groupOtherCases,
  normalizePlate,
  personMatchReasons,
  personProbeIsSearchable,
  plateIsSearchable,
  plateSearchChunk,
  type CaseCrossHits,
  type PersonCrossHit,
  type PersonProbe,
  type VehicleCrossHit,
} from '@/lib/cross-hits'

const caseSelect = { id: true, caseNumber: true, title: true } as const
const MAX_CANDIDATES = 50
const MAX_HITS = 5

/**
 * Bestehende Personen, die zu den Eingaben passen. Verschlusssachen, die der
 * Nutzer nicht sehen darf, werden nicht mitgezählt – sonst verriete schon die
 * Zahl, dass es eine geheime Akte zu dieser Person gibt.
 */
export async function findPersonCrossHits(
  user: CurrentUser,
  probe: PersonProbe,
  excludeId?: string | null,
): Promise<PersonCrossHit[]> {
  if (!personProbeIsSearchable(probe)) return []

  const or: Prisma.PersonWhereInput[] = []
  const first = probe.firstName?.trim()
  const last = probe.lastName?.trim()
  if (first && last) or.push({ firstName: first, lastName: last })
  const alias = probe.alias?.trim()
  if (alias && alias.length >= 2) {
    or.push({ alias })
    const [aliasFirst, ...aliasRest] = alias.split(/\s+/)
    if (aliasRest.length > 0) or.push({ firstName: aliasFirst, lastName: aliasRest.join(' ') })
  }
  const identifier = probe.identifier?.trim()
  if (identifier && identifier.length >= 2) or.push({ identifier })
  // Telefonnummern stehen in vielen Schreibweisen in der Datenbank. Die letzten
  // Ziffern grenzen grob vor, die genaue Prüfung folgt in `personMatchReasons`.
  const phoneDigits = (probe.phone ?? '').replace(/\D/g, '')
  if (phoneDigits.length >= 4) or.push({ phone: { contains: phoneDigits.slice(-4) } })

  const candidates = await prisma.person.findMany({
    where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    take: MAX_CANDIDATES,
    select: {
      id: true,
      personNumber: true,
      firstName: true,
      lastName: true,
      alias: true,
      identifier: true,
      phone: true,
      investigations: {
        where: { investigation: investigationVisibilityWhere(user) },
        select: { investigation: { select: caseSelect } },
      },
    },
  })

  return candidates
    .map((candidate) => ({ candidate, reasons: personMatchReasons(probe, candidate) }))
    .filter(({ reasons }) => reasons.length > 0)
    .slice(0, MAX_HITS)
    .map(({ candidate, reasons }) => ({
      kind: 'person' as const,
      id: candidate.id,
      code: candidate.personNumber,
      name: `${candidate.firstName} ${candidate.lastName}${candidate.alias ? ` „${candidate.alias}“` : ''}`,
      matchedOn: reasons,
      investigations: dedupeCases(candidate.investigations.map((link) => link.investigation)),
    }))
}

export async function findVehicleCrossHits(
  user: CurrentUser,
  plate: string,
  excludeId?: string | null,
): Promise<VehicleCrossHit[]> {
  if (!plateIsSearchable(plate)) return []
  const wanted = normalizePlate(plate)

  const candidates = await prisma.vehicle.findMany({
    where: {
      plate: { contains: plateSearchChunk(plate) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    take: MAX_CANDIDATES,
    select: {
      id: true,
      vehicleNumber: true,
      plate: true,
      model: true,
      investigations: {
        where: { investigation: investigationVisibilityWhere(user) },
        select: { investigation: { select: caseSelect } },
      },
    },
  })

  return candidates
    .filter((candidate) => normalizePlate(candidate.plate) === wanted)
    .slice(0, MAX_HITS)
    .map((candidate) => ({
      kind: 'vehicle' as const,
      id: candidate.id,
      code: candidate.vehicleNumber,
      name: [candidate.plate, candidate.model].filter(Boolean).join(' · '),
      matchedOn: ['Kennzeichen'],
      investigations: dedupeCases(candidate.investigations.map((link) => link.investigation)),
    }))
}

/** Für die Akte: in welchen weiteren Akten tauchen ihre Personen und Fahrzeuge auf? */
export async function caseCrossHits(
  user: CurrentUser,
  investigationId: string,
  personIds: readonly string[],
  vehicleIds: readonly string[],
): Promise<CaseCrossHits> {
  const visible = investigationVisibilityWhere(user)
  const [personLinks, vehicleLinks] = await Promise.all([
    personIds.length
      ? prisma.investigationPerson.findMany({
          where: { personId: { in: [...personIds] }, investigationId: { not: investigationId }, investigation: visible },
          select: { personId: true, investigation: { select: caseSelect } },
        })
      : [],
    vehicleIds.length
      ? prisma.investigationVehicle.findMany({
          where: { vehicleId: { in: [...vehicleIds] }, investigationId: { not: investigationId }, investigation: visible },
          select: { vehicleId: true, investigation: { select: caseSelect } },
        })
      : [],
  ])

  return {
    persons: groupOtherCases(
      personLinks.map((link) => ({ key: link.personId, investigation: link.investigation })),
      investigationId,
    ),
    vehicles: groupOtherCases(
      vehicleLinks.map((link) => ({ key: link.vehicleId, investigation: link.investigation })),
      investigationId,
    ),
  }
}

function dedupeCases<T extends { id: string }>(cases: T[]) {
  const seen = new Set<string>()
  return cases.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

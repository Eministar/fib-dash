import 'server-only'

import { error, forbidden, unauthorized } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { nextSequenceNumber } from '@/lib/sequence-numbers'
import { INVESTIGATION_CASE_PREFIX, PERSON_NUMBER_PREFIX } from '@/lib/investigations'
import type { Prisma } from '@/generated/prisma'

/**
 * Einheitliche Fehlerabbildung für die Ermittlungs-Routen: `requirePermission`
 * wirft `Unauthorized`/`Forbidden`, alles andere ist ein Serverfehler.
 */
export function routeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Serverfehler'
  if (message === 'Unauthorized') return unauthorized()
  if (message === 'Forbidden') return forbidden()
  return error(message, 500)
}

export async function nextInvestigationCaseNumber() {
  const existing = await prisma.investigation.findMany({ select: { caseNumber: true } })
  return nextSequenceNumber(
    INVESTIGATION_CASE_PREFIX,
    existing.map((row) => row.caseNumber),
  )
}

export async function nextPersonNumber() {
  const existing = await prisma.person.findMany({ select: { personNumber: true } })
  return nextSequenceNumber(
    PERSON_NUMBER_PREFIX,
    existing.map((row) => row.personNumber),
  )
}

/**
 * Prisma akzeptiert für JSON-Spalten nur `InputJsonValue`. Unsere bereits
 * bereinigten Arrays erfüllen das strukturell, nicht aber nominell.
 */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

export function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function agentDisplayName(
  agent: { firstName: string; lastName: string; badgeNumber: string } | null | undefined,
) {
  if (!agent) return null
  return `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`
}

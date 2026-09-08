import 'server-only'

import { error, forbidden, unauthorized } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { nextSequenceNumber } from '@/lib/sequence-numbers'
import {
  EVIDENCE_NUMBER_PREFIX,
  INVESTIGATION_CASE_PREFIX,
  PERSON_NUMBER_PREFIX,
  VEHICLE_NUMBER_PREFIX,
} from '@/lib/investigations'
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
export async function nextEvidenceNumber() {
  const existing = await prisma.evidence.findMany({ select: { itemNumber: true } })
  return nextSequenceNumber(
    EVIDENCE_NUMBER_PREFIX,
    existing.map((row) => row.itemNumber),
  )
}

export async function nextVehicleNumber() {
  const existing = await prisma.vehicle.findMany({ select: { vehicleNumber: true } })
  return nextSequenceNumber(
    VEHICLE_NUMBER_PREFIX,
    existing.map((row) => row.vehicleNumber),
  )
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

/**
 * Nimmt eine rohe Liste von Agent-IDs entgegen und gibt sie dedupliziert
 * zurueck. Wirft, wenn ein Eintrag kein bekannter Agent ist – so schlaegt eine
 * Zuweisung fehl, statt still zu verschwinden.
 */
export async function validateAgentIds(value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Ermittlerliste ist ungueltig')

  const ids = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  )
  if (ids.length === 0) return []

  const known = await prisma.agent.count({ where: { id: { in: ids } } })
  if (known !== ids.length) throw new Error('Mindestens ein Ermittler wurde nicht gefunden')

  return ids
}

export function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Stueckzahl eines Asservats: nur positive Ganzzahlen, sonst nicht gesetzt. */
export function parseQuantity(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isSafeInteger(num) && num > 0 ? num : null
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

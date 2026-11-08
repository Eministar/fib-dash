import 'server-only'

import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { nextSequenceNumber } from '@/lib/core/sequence-numbers'
import {
  EVIDENCE_NUMBER_PREFIX,
  INVESTIGATION_CASE_PREFIX,
  PERSON_NUMBER_PREFIX,
  VEHICLE_NUMBER_PREFIX,
} from '@/lib/investigations/investigations'
import { FibCodeError, readFibCode, type FibPayload } from '@/lib/investigations/fib-code'
import { draftOccurredAt, importSourceKey, type ImportDraft } from '@/lib/investigations/fib-code-import'

/** Signatur-Schlüssel; muss mit `nerov_mdt_fibcode_secret` im FiveM-Server übereinstimmen. */
export function fibCodeSecret() {
  return process.env.FIB_CODE_SECRET
}

/** Dekodiert und prüft einen Code (Format, Signatur, Schema). Wirft `FibCodeError`. */
export function verifyFibCode(code: string): FibPayload {
  return readFibCode(code, fibCodeSecret())
}

export function fibCodeErrorStatus(error: FibCodeError) {
  return error.reason === 'no_secret' ? 503 : 400
}

export async function findImportedInvestigation(sourceKey: string) {
  return prisma.investigation.findUnique({
    where: { sourceKey },
    select: { id: true, caseNumber: true, title: true },
  })
}

export class DuplicateImportError extends Error {
  constructor(public readonly existing: { id: string; caseNumber: string; title: string }) {
    super(`Dieser Einsatz wurde bereits als ${existing.caseNumber} importiert.`)
  }
}

const normalizePlate = (plate: string) => plate.replace(/\s+/g, '').toUpperCase()

/**
 * Legt die Akte samt Personen, Fahrzeugen, Asservaten und Einsatzeintrag in
 * einer Transaktion an. Die Herkunft (`sourceKey`) ist eindeutig – ein zweiter
 * Import desselben Einsatzes scheitert mit `DuplicateImportError`.
 */
export async function createInvestigationFromImport(params: {
  userId: string
  payload: FibPayload
  draft: ImportDraft
}) {
  const { userId, payload, draft } = params
  const sourceKey = importSourceKey(payload)

  const existing = await findImportedInvestigation(sourceKey)
  if (existing) throw new DuplicateImportError(existing)

  const occurredAt = draftOccurredAt(draft)
  // Ohne Einsatzzeitpunkt gibt es keinen Chronologie-Eintrag (er braucht einen
  // Zeitpunkt, der nicht erfunden werden soll) – der Bericht steht dann in der Zusammenfassung.
  const asEntry = Boolean(draft.report && occurredAt)
  const summary = !asEntry && draft.report
    ? [draft.summary, `## Einsatzbericht\n${draft.report}`].filter(Boolean).join('\n\n')
    : draft.summary
  const closed = draft.status === 'CLOSED' || draft.status === 'ARCHIVED'

  try {
    return await prisma.$transaction(async (tx) => {
      const caseNumbers = await tx.investigation.findMany({ select: { caseNumber: true } })
      const caseNumber = nextSequenceNumber(INVESTIGATION_CASE_PREFIX, caseNumbers.map((row) => row.caseNumber))

      const investigation = await tx.investigation.create({
        data: {
          caseNumber,
          title: draft.title,
          summary: summary || null,
          status: draft.status,
          priority: draft.priority,
          closedAt: closed ? new Date() : null,
          sourceKey,
          createdById: userId,
        },
        select: { id: true, caseNumber: true },
      })

      const entry = asEntry && occurredAt
        ? await tx.investigationEntry.create({
            data: {
              investigationId: investigation.id,
              kind: 'OPERATION',
              title: `Einsatz laut MDT-Akte #${payload.src.caseId}`,
              content: draft.report,
              occurredAt,
              location: draft.location || null,
              createdById: userId,
            },
            select: { id: true },
          })
        : null

      // Personen: bestehende Registereinträge (gleicher Name) werden weiterverwendet.
      if (draft.persons.length) {
        const personNumbers = (await tx.person.findMany({ select: { personNumber: true } })).map((row) => row.personNumber)
        const linked = new Set<string>()
        for (const person of draft.persons) {
          let record = await tx.person.findFirst({
            where: { firstName: person.firstName, lastName: person.lastName },
            select: { id: true },
          })
          if (!record) {
            const personNumber = nextSequenceNumber(PERSON_NUMBER_PREFIX, personNumbers)
            personNumbers.push(personNumber)
            record = await tx.person.create({
              data: { personNumber, firstName: person.firstName, lastName: person.lastName, createdById: userId },
              select: { id: true },
            })
          }
          const key = `${record.id}:${person.role}`
          if (linked.has(key)) continue
          linked.add(key)
          await tx.investigationPerson.create({
            data: { investigationId: investigation.id, personId: record.id, role: person.role, note: person.note || null },
          })
        }
      }

      if (draft.vehicles.length) {
        const vehicleNumbers = (await tx.vehicle.findMany({ select: { vehicleNumber: true } })).map((row) => row.vehicleNumber)
        const linked = new Set<string>()
        for (const vehicle of draft.vehicles) {
          const plate = normalizePlate(vehicle.plate)
          let record = await tx.vehicle.findFirst({
            where: { plate: { in: Array.from(new Set([vehicle.plate, plate])) } },
            select: { id: true },
          })
          if (!record) {
            const vehicleNumber = nextSequenceNumber(VEHICLE_NUMBER_PREFIX, vehicleNumbers)
            vehicleNumbers.push(vehicleNumber)
            record = await tx.vehicle.create({
              data: { vehicleNumber, plate: vehicle.plate, model: vehicle.model || null, createdById: userId },
              select: { id: true },
            })
          }
          if (linked.has(record.id)) continue
          linked.add(record.id)
          await tx.investigationVehicle.create({
            data: {
              investigationId: investigation.id,
              vehicleId: record.id,
              note: vehicle.owner ? `Halter laut MDT: ${vehicle.owner}` : null,
            },
          })
        }
      }

      if (draft.items.length) {
        const evidenceNumbers = (await tx.evidence.findMany({ select: { itemNumber: true } })).map((row) => row.itemNumber)
        for (const item of draft.items) {
          const itemNumber = nextSequenceNumber(EVIDENCE_NUMBER_PREFIX, evidenceNumbers)
          evidenceNumbers.push(itemNumber)
          await tx.evidence.create({
            data: {
              investigationId: investigation.id,
              entryId: entry?.id ?? null,
              itemNumber,
              title: item.title,
              quantity: item.quantity,
              seizedAt: occurredAt,
              seizedLocation: draft.location || null,
              createdById: userId,
            },
          })
        }
      }

      await createAuditLog(
        {
          action: 'INVESTIGATION_CREATED',
          userId,
          details: `Ermittlungsakte ${caseNumber}: "${draft.title}" (Import per Einsatzcode, MDT-Akte #${payload.src.caseId})`,
        },
        tx,
      )

      return investigation
    })
  } catch (cause) {
    // Zwei gleichzeitige Importe: der zweite scheitert am Unique-Index.
    if (typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'P2002') {
      const raced = await findImportedInvestigation(sourceKey)
      if (raced) throw new DuplicateImportError(raced)
    }
    throw cause
  }
}

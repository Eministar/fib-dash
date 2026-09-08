import { z } from 'zod'

export function officialNumber(id: number) { return `BEA-${String(id).padStart(6, '0')}` }
export function parseOfficialNumber(value: string) {
  const match = /^(?:BEA-)?0*(\d+)$/i.exec(value.trim())
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null
}

const officialId = z.number().int().positive().max(2147483647)
export const corruptionCheckSchema = z.object({
  requestId: z.uuid(),
  officialId: officialId.optional(),
  official: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    agency: z.string().trim().min(1).max(150),
    badgeNumber: z.string().trim().max(100).optional(),
  }).strict().optional(),
  conductedAt: z.iso.datetime({ offset: true }).refine(v => new Date(v).getTime() <= Date.now() + 60_000, 'Eine durchgeführte Kontrolle darf nicht in der Zukunft liegen'),
  agentIds: z.array(z.string().trim().min(1).max(191)).min(1, 'Mindestens einen durchführenden Agent auswählen').max(30).transform(ids => [...new Set(ids)]),
  result: z.enum(['CLEAR', 'FINDINGS']),
  findings: z.string().trim().max(30000),
  location: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(30000).optional(),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.officialId) === Boolean(input.official)) ctx.addIssue({ code: 'custom', message: 'Eine bestehende Beamtenakte wählen oder einen neuen Beamten anlegen', path: ['officialId'] })
  if (input.result === 'FINDINGS' && !input.findings) ctx.addIssue({ code: 'custom', message: 'Bitte den Befund beschreiben', path: ['findings'] })
})

export const corruptionQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  agency: z.string().trim().max(150).default(''),
  officialId: z.coerce.number().int().positive().max(2147483647).optional(),
  agentId: z.string().trim().min(1).max(191).optional(),
  result: z.enum(['CLEAR', 'FINDINGS']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  order: z.enum(['newest', 'oldest']).default('newest'),
}).refine(q => !q.from || !q.to || new Date(q.from) <= new Date(q.to), 'Der Beginn muss vor dem Ende des Zeitraums liegen')

export type CorruptionInput = z.infer<typeof corruptionCheckSchema>

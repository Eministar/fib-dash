/** Eingabeprüfung der Qualitätskontrollen (Server und Formulare). */
import { z } from 'zod'

import { QC_CHECK_TYPES, QC_ENTRY_KINDS, QC_RATINGS, QC_SHARE_SCOPES, isQcGrade, roundGrade } from '@/lib/quality-checks'

const gradeSchema = z
  .number()
  .refine(isQcGrade, 'Note 1+ bis 6')
  .transform(roundGrade)

const isoDate = z.iso.datetime({ offset: true })
const notInFuture = (value: string) => new Date(value).getTime() <= Date.now() + 5 * 60_000

export const qcCreateSchema = z
  .object({
    lspdOfficerId: z.string().trim().min(1).max(191),
    checkType: z.enum(QC_CHECK_TYPES).default('PATROL'),
    startedAt: isoDate.refine(notInFuture, 'Der Beginn darf nicht in der Zukunft liegen').optional(),
    location: z.string().trim().max(200).optional(),
  })
  .strict()

export const qcEntrySchema = z
  .object({
    kind: z.enum(QC_ENTRY_KINDS),
    text: z.string().trim().min(1, 'Bitte etwas eintragen').max(5000),
    occurredAt: isoDate.refine(notInFuture, 'Der Zeitpunkt darf nicht in der Zukunft liegen').optional(),
    /** Korrigiert einen früheren Eintrag derselben Kontrolle. */
    correctsId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()

/** Eintrag einer laufenden Kontrolle nachträglich ändern. */
export const qcEntryUpdateSchema = z
  .object({
    kind: z.enum(QC_ENTRY_KINDS).optional(),
    text: z.string().trim().min(1, 'Bitte etwas eintragen').max(5000).optional(),
    occurredAt: isoDate.refine(notInFuture, 'Der Zeitpunkt darf nicht in der Zukunft liegen').optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), 'Keine Änderung angegeben')

const reportText = z.string().trim().min(1, 'Bitte einen Abschlussbericht schreiben').max(20000)

export const qcCompleteSchema = z
  .object({
    rating: z.enum(QC_RATINGS),
    grade: gradeSchema.nullable().optional(),
    summary: reportText,
    endedAt: isoDate.refine(notInFuture, 'Das Ende darf nicht in der Zukunft liegen').optional(),
    location: z.string().trim().max(200).optional(),
  })
  .strict()

/** Abschlussbericht einer abgeschlossenen Kontrolle überarbeiten. */
export const qcReportSchema = z.object({ summary: reportText }).strict()

/** Note einer laufenden Kontrolle setzen oder zurücknehmen (`null`). */
export const qcGradeSchema = z.object({ grade: gradeSchema.nullable() }).strict()

export const qcShareSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    scope: z.enum(QC_SHARE_SCOPES),
    checkId: z.string().trim().min(1).max(191).nullable().default(null),
    lspdOfficerId: z.string().trim().min(1).max(191).nullable().default(null),
    includeCareer: z.boolean().default(false),
    enabled: z.boolean().default(true),
    expiresAt: isoDate.nullable().default(null),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.scope === 'CHECK' && !input.checkId) ctx.addIssue({ code: 'custom', message: 'Bitte die Kontrolle wählen', path: ['checkId'] })
    if (input.scope === 'OFFICER' && !input.lspdOfficerId) ctx.addIssue({ code: 'custom', message: 'Bitte den Beamten wählen', path: ['lspdOfficerId'] })
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'Das Ablaufdatum muss in der Zukunft liegen', path: ['expiresAt'] })
    }
  })

export const qcShareUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    expiresAt: isoDate.nullable().optional(),
    includeCareer: z.boolean().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    /** Neuen geheimen Link erzeugen; der alte wird ungültig. */
    rotate: z.literal(true).optional(),
  })
  .strict()


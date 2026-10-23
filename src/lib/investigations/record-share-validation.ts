import { z } from 'zod'
import { raidRequestSchema } from '@/lib/investigations/raid-request-schema'
import { SHARE_KINDS } from '@/lib/investigations/record-share-kinds'

export { SHARE_KINDS, includesSharedItem, shareIsActive, type ShareKind, type ShareSelection } from '@/lib/investigations/record-share-kinds'

export const shareKindSchema = z.enum(Object.keys(SHARE_KINDS) as [keyof typeof SHARE_KINDS, ...(keyof typeof SHARE_KINDS)[]])
export const shareSelectionSchema = z.object({ kind: shareKindSchema, recordId: z.string().min(1).max(191) }).strict()
export const shareSchema = z.object({
  title: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  /** Mit Antrag wird der Link zum Razzia-Antrag; die Akten sind dann die Anlagen. */
  raidRequest: raidRequestSchema.nullable().default(null),
  items: z.array(shareSelectionSchema).min(1, 'Mindestens einen Eintrag auswählen').max(100).refine(items => new Set(items.map(i => `${i.kind}:${i.recordId}`)).size === items.length, 'Einträge dürfen nicht doppelt vorkommen'),
}).strict()
export const shareUpdateSchema = shareSchema.extend({ version: z.number().int().positive() })

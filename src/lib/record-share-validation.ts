import { z } from 'zod'

export const SHARE_KINDS = { DOSSIER: 'Dauerakten / Unterakten', CASE: 'Einzelakten / Einsatzakten', PERSON: 'Personenakten', VEHICLE: 'Fahrzeugakten', CLIP: 'Bodycams' } as const
export type ShareKind = keyof typeof SHARE_KINDS
export const shareKindSchema = z.enum(['DOSSIER', 'CASE', 'PERSON', 'VEHICLE', 'CLIP'])
export const shareSelectionSchema = z.object({ kind: shareKindSchema, recordId: z.string().min(1).max(191) }).strict()
export const shareSchema = z.object({
  title: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  items: z.array(shareSelectionSchema).min(1, 'Mindestens einen Eintrag auswählen').max(100).refine(items => new Set(items.map(i => `${i.kind}:${i.recordId}`)).size === items.length, 'Einträge dürfen nicht doppelt vorkommen'),
}).strict()
export const shareUpdateSchema = shareSchema.extend({ version: z.number().int().positive() })
export type ShareSelection = z.infer<typeof shareSelectionSchema>
export function shareIsActive(share: { enabled: boolean; expiresAt: Date | null }, now = new Date()) {
  return share.enabled && (!share.expiresAt || share.expiresAt.getTime() > now.getTime())
}
export function includesSharedItem(items: ShareSelection[], kind: string, recordId: string) {
  return items.some(item => item.kind === kind && item.recordId === recordId)
}

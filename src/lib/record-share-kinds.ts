/**
 * Arten freigegebener Einträge und kleine Prüfungen ohne zod – für die
 * öffentliche Leseansicht, die nichts validiert.
 */
export const SHARE_KINDS = { DOSSIER: 'Dauerakten', CASE: 'Einzelakten / Einsatzakten', PERSON: 'Personenakten', VEHICLE: 'Fahrzeugakten', CLIP: 'Bodycams' } as const
export type ShareKind = keyof typeof SHARE_KINDS
export type ShareSelection = { kind: ShareKind; recordId: string }
export function shareIsActive(share: { enabled: boolean; expiresAt: Date | null }, now = new Date()) {
  return share.enabled && (!share.expiresAt || share.expiresAt.getTime() > now.getTime())
}
export function includesSharedItem(items: ShareSelection[], kind: string, recordId: string) {
  return items.some(item => item.kind === kind && item.recordId === recordId)
}

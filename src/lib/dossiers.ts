export const DOSSIER_KINDS = { FAMILY: 'Familienakte', COLLECTION: 'Sammelakte', PROPERTY: 'Anwesen' } as const
export type DossierKind = keyof typeof DOSSIER_KINDS

export const DOSSIER_KINDS = { FAMILY: 'Fraktion / Familie', COLLECTION: 'Sammelakte', PROPERTY: 'Anwesen' } as const
export type DossierKind = keyof typeof DOSSIER_KINDS

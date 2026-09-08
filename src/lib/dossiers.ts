export const DOSSIER_KINDS = { FAMILY: 'Familienakte', COLLECTION: 'Sammelakte', PROPERTY: 'Anwesen', FILE: 'Unterakte' } as const
export type DossierKind = keyof typeof DOSSIER_KINDS

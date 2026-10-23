/**
 * Eine Familienakte bündelt alles zu einer Familie oder Fraktion: Leiter,
 * Anwesen, Mitglieder, Fahrzeuge, Orte und alle Einsatzakten. Die Übersicht
 * aller Familienakten heißt Familienregister.
 */
export const DOSSIER_LABEL = 'Familienakte'
export const DOSSIER_LABEL_PLURAL = 'Familienakten'
export const DOSSIER_REGISTER_LABEL = 'Familienregister'

/** Status, unter denen eine Einsatzakte als „offen“ zählt. */
export const OPEN_INVESTIGATION_STATUSES = ['OPEN', 'ACTIVE', 'SUSPENDED'] as const

export const DOSSIER_SORTS = { activity: 'Letzte Aktivität', open: 'Offene Akten', name: 'Name' } as const
export type DossierSort = keyof typeof DOSSIER_SORTS

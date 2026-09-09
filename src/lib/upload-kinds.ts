// Bewusst ohne Node-Imports: diese Datei wird auch von Client-Komponenten
// genutzt. Alles, was das Dateisystem oder die Datenbank braucht, liegt in
// `upload-sessions.ts`.

export const UPLOAD_KINDS = ['CLIP', 'EVIDENCE', 'PHOTO', 'RESOURCE'] as const

export type UploadKind = (typeof UPLOAD_KINDS)[number]

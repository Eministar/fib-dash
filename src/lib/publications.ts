import { z } from 'zod'

export const PUBLICATION_KINDS = { NOTICE: 'Schreiben', TABLE: 'Tabelle' } as const
export const PUBLICATION_STATUS = { DRAFT: 'Entwurf', PUBLISHED: 'Veröffentlicht', ARCHIVED: 'Archiviert' } as const
export type PublicationKind = keyof typeof PUBLICATION_KINDS
export type PublicationStatus = keyof typeof PUBLICATION_STATUS

export type PublicationTable = { columns: string[]; rows: string[][] }
export type PublicationAccess = 'PUBLIC' | 'ROLES'

/** Eigene Link-Namen: Kleinbuchstaben, Ziffern und Bindestriche. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/

export const MAX_TABLE_COLUMNS = 30
export const MAX_TABLE_ROWS = 2000

const cell = z.string().max(2000)

export const publicationInput = z.object({
  kind: z.enum(['NOTICE', 'TABLE']),
  title: z.string().trim().min(1, 'Titel fehlt').max(200),
  summary: z.string().trim().max(500).optional().default(''),
  content: z.string().max(100_000).default(''),
  table: z.object({
    columns: z.array(cell).min(1, 'Mindestens eine Spalte').max(MAX_TABLE_COLUMNS),
    rows: z.array(z.array(cell).max(MAX_TABLE_COLUMNS)).max(MAX_TABLE_ROWS),
  }).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  slug: z.string().trim().toLowerCase().optional().default('')
    .refine((value) => !value || SLUG_PATTERN.test(value), 'Link-Name: 3–80 Zeichen, nur a–z, 0–9 und Bindestriche'),
  access: z.enum(['PUBLIC', 'ROLES']).default('PUBLIC'),
  roleIds: z.array(z.string().regex(/^\d{17,22}$/, 'Ungültige Rollen-ID')).max(50).default([]),
  listed: z.boolean().default(true),
  pinned: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.kind === 'TABLE' && !value.table) ctx.addIssue({ code: 'custom', message: 'Tabelle fehlt', path: ['table'] })
  if (value.kind === 'NOTICE' && !value.content.trim()) ctx.addIssue({ code: 'custom', message: 'Text fehlt', path: ['content'] })
  if (value.access === 'ROLES' && value.roleIds.length === 0) ctx.addIssue({ code: 'custom', message: 'Bitte mindestens eine Discord-Rolle freigeben', path: ['roleIds'] })
})

export type PublicationInput = z.infer<typeof publicationInput>

/** Zeilen auf die Spaltenzahl bringen und komplett leere Zeilen entfernen. */
export function normalizeTable(table: PublicationTable): PublicationTable {
  const width = table.columns.length
  return {
    columns: table.columns.map((column, index) => column.trim() || `Spalte ${index + 1}`),
    rows: table.rows
      .map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()))
      .filter((row) => row.some(Boolean)),
  }
}

export function readTable(value: unknown): PublicationTable | null {
  if (!value || typeof value !== 'object') return null
  const { columns, rows } = value as { columns?: unknown; rows?: unknown }
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null
  return {
    columns: columns.map(String),
    rows: rows.filter(Array.isArray).map((row) => (row as unknown[]).map((item) => String(item ?? ''))),
  }
}

/**
 * Aus Excel/Google Sheets kopierte Daten (Tab-getrennt) oder CSV einlesen.
 * Die erste Zeile wird zu den Spaltenüberschriften.
 */
export function parsePastedTable(text: string): PublicationTable | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length === 0) return null
  const separator = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const split = (line: string) => {
    if (separator === '\t') return line.split('\t')
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (let index = 0; index < line.length; index++) {
      const char = line[index]
      if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index++ }
      else if (char === '"') quoted = !quoted
      else if (char === separator && !quoted) { cells.push(current); current = '' }
      else current += char
    }
    cells.push(current)
    return cells
  }
  const [header, ...rows] = lines.map(split)
  return normalizeTable({ columns: header.slice(0, MAX_TABLE_COLUMNS), rows: rows.slice(0, MAX_TABLE_ROWS) })
}

export function readRoleIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function publicationSlug(title: string, random: string) {
  const base = title
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'aushang'}-${random}`
}

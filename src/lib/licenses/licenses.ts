/** Lizenzarten: gemeinsame Prüfung der Eingaben für Anlegen und Bearbeiten. */

export type LicenseInput = {
  key: string
  label: string
  description: string | null
  cooldownDays: number
  sortOrder: number
  active: boolean
}

/** Liefert die bereinigte Eingabe oder eine Fehlermeldung. */
export function parseLicenseInput(body: unknown): LicenseInput | string {
  if (!body || typeof body !== 'object') return 'Ungültige Daten'
  const raw = body as Record<string, unknown>
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const key = typeof raw.key === 'string' ? raw.key.trim().toLowerCase() : ''
  if (!label) return 'Name ist erforderlich'
  if (!/^[a-z0-9_-]{2,40}$/.test(key)) return 'Key: 2–40 Zeichen, nur a–z, 0–9, _ und -'
  const cooldownDays = Number(raw.cooldownDays ?? 0)
  if (!Number.isInteger(cooldownDays) || cooldownDays < 0 || cooldownDays > 365) return 'Sperrfrist: 0–365 Tage'
  const sortOrder = Number(raw.sortOrder ?? 0)
  return {
    key,
    label: label.slice(0, 80),
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim().slice(0, 2000) : null,
    cooldownDays,
    sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 0,
    active: raw.active !== false,
  }
}

/**
 * LSPD-Beamte aus dem lspd-hr-Panel – Typen und Beschriftungen. Frei von
 * Server-Importen; die Daten kommen über `/api/lspd/officers`.
 */

export interface LspdOfficer {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId: string | null
  status: string
  rank: { name: string; color: string; sortOrder: number }
  units: { key: string; name: string }[]
  hireDate: string
}

export interface LspdOfficerFile extends LspdOfficer {
  promotions: { at: string; fromRank: string; toRank: string; fromBadge: string | null; toBadge: string | null; note: string | null }[]
  sanctions: {
    at: string
    reason: string
    penalGrade: string
    measureType: string
    status: string
    fineAmount: number | null
    penalty: string | null
  }[]
  trainings: { label: string; completed: boolean }[]
  terminations: { at: string; reason: string }[]
}

export const LSPD_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktiv',
  AWAY: 'Abgemeldet',
  INACTIVE: 'Inaktiv',
  TERMINATED: 'Gekündigt',
}

/** Status, die in Auswahl und Beamtenliste standardmäßig erscheinen (ohne Gekündigte). */
export const LSPD_ACTIVE_STATUSES = ['ACTIVE', 'AWAY', 'INACTIVE'] as const

/**
 * Das Panel markiert Dienstnummern Gekündigter intern als
 * „<DN>__terminated__<id>“. Angezeigt wird nur die eigentliche Dienstnummer.
 */
export function cleanLspdBadge(badgeNumber: string | null | undefined) {
  const value = (badgeNumber ?? '').trim()
  const index = value.indexOf('__terminated__')
  return index >= 0 ? value.slice(0, index).trim() : value
}

/** Bereinigt eine Antwort des Panels – auch falls dort noch eine ältere Version läuft. */
export function normalizeLspdOfficer<T extends LspdOfficer>(officer: T): T {
  const file = officer as T & Partial<Pick<LspdOfficerFile, 'promotions'>>
  return {
    ...officer,
    badgeNumber: cleanLspdBadge(officer.badgeNumber),
    ...(file.promotions
      ? {
          promotions: file.promotions.map((item) => ({
            ...item,
            fromBadge: item.fromBadge ? cleanLspdBadge(item.fromBadge) : null,
            toBadge: item.toBadge ? cleanLspdBadge(item.toBadge) : null,
          })),
        }
      : {}),
  }
}

export const LSPD_AGENCY = 'LSPD'

export function lspdOfficerName(officer: Pick<LspdOfficer, 'firstName' | 'lastName'>) {
  return `${officer.firstName} ${officer.lastName}`.trim()
}

export function lspdStatusLabel(status: string) {
  return LSPD_STATUS_LABELS[status] ?? status
}

/** Momentaufnahme, die mit einem Eintrag gespeichert wird – falls das Panel später nicht erreichbar ist. */
export interface LspdOfficerSnapshot {
  id: string
  name: string
  badgeNumber: string
  rank: string
}

export function lspdSnapshot(officer: LspdOfficer): LspdOfficerSnapshot {
  return { id: officer.id, name: lspdOfficerName(officer), badgeNumber: officer.badgeNumber, rank: officer.rank.name }
}

/** Nimmt nur gültige Snapshots an (z. B. aus JSON-Spalten). */
export function readLspdSnapshot(value: unknown): LspdOfficerSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return {
    id: raw.id,
    name: raw.name,
    badgeNumber: typeof raw.badgeNumber === 'string' ? raw.badgeNumber : '',
    rank: typeof raw.rank === 'string' ? raw.rank : '',
  }
}

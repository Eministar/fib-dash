import type { Rank } from '@/generated/prisma/client'

/**
 * Liest die numerische Dienstnummer (ohne optionales Präfix aus den Einstellungen).
 */
export function parseBadgeNumberToInt(badgeNumber: string, prefix: string): number | null {
  const raw = badgeNumberRawDigits(badgeNumber, prefix)
  if (raw === null) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function stripTerminatedBadgeNumber(badgeNumber: string) {
  const trimmed = badgeNumber.trim()
  const marker = '__terminated__'
  const markerIndex = trimmed.indexOf(marker)
  return markerIndex >= 0 ? trimmed.slice(0, markerIndex).trim() : trimmed
}

export function displayBadgeNumber(badgeNumber?: string | null) {
  const trimmed = badgeNumber?.trim() ?? ''
  if (!trimmed) return '—'
  const visible = stripTerminatedBadgeNumber(trimmed)
  return visible.replace(/(\d+)$/, (digits) => digits.padStart(2, '0'))
}

function badgeNumberRawDigits(badgeNumber: string, prefix: string): string | null {
  const raw = (prefix && badgeNumber.startsWith(prefix) ? badgeNumber.slice(prefix.length) : badgeNumber).trim()
  if (!/^\d+$/.test(raw)) return null
  return raw
}

/**
 * Baut die Dienstnummer-String aus Zahl + optionalem Präfix.
 */
export function formatBadgeNumber(n: number, prefix: string): string {
  return formatBadgeNumberWithWidth(n, prefix, 2)
}

function formatBadgeNumberWithWidth(n: number, prefix: string, width: number): string {
  const value = String(n).padStart(Math.max(2, width), '0')
  return prefix ? `${prefix}${value}` : value
}

/**
 * Normalisiert manuelle Eingaben auf mindestens zwei Ziffern.
 * Nicht-numerische Sonderformate bleiben unverändert.
 */
export function normalizeBadgeNumber(badgeNumber: string, prefix: string): string {
  const trimmed = badgeNumber.trim()
  const raw = badgeNumberRawDigits(trimmed, prefix)
  if (raw === null) return trimmed
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return trimmed
  return formatBadgeNumberWithWidth(value, prefix, Math.max(2, raw.length))
}

/**
 * Sammelt alle belegten numerischen Dienstnummern (global, alle Agents).
 */
export function collectUsedBadgeInts(
  rows: { badgeNumber: string }[],
  prefix: string
): Set<number> {
  const used = new Set<number>()
  for (const row of rows) {
    const n = parseBadgeNumberToInt(row.badgeNumber, prefix)
    if (n !== null) used.add(n)
  }
  return used
}

/**
 * Sucht die kleinste freie Nummer in [min, max] (inklusiv), die nicht in `used` liegt.
 * Optional `excludeInt`: aktuelle Nummer des Agents, die bei Rangwechsel „frei“ wird, bevor neu vergeben wird.
 */
export function findNextFreeBadgeInRange(
  min: number,
  max: number,
  used: Set<number>,
  excludeInt: number | null
): number | null {
  if (min > max) return null
  const ex = new Set(used)
  if (excludeInt !== null) ex.delete(excludeInt)
  for (let n = min; n <= max; n++) {
    if (!ex.has(n)) return n
  }
  return null
}

/**
 * Sucht ab `start` aufwärts (bis 9999) die kleinste freie Nummer — Fallback,
 * wenn der Rangbereich voll ist oder kein Bereich existiert („zur Not weiterzählen“).
 */
export function findNextFreeBadgeFrom(
  start: number,
  used: Set<number>,
  excludeInt: number | null = null
): number | null {
  return findNextFreeBadgeInRange(Math.max(0, start), 9999, used, excludeInt)
}

export function rankHasBadgeRange(rank: Pick<Rank, 'badgeMin' | 'badgeMax'>): rank is { badgeMin: number; badgeMax: number } {
  return rank.badgeMin != null && rank.badgeMax != null && rank.badgeMin <= rank.badgeMax
}

export type RankChangeBadgeEntry = {
  id: string
  newBadgeNumber: string | null
  agent: { badgeNumber: string }
  proposedRank: Pick<Rank, 'badgeMin' | 'badgeMax'>
}

/**
 * Berechnet die effektiven Dienstnummern für offene Listeneinträge (Beförderungs-/Degradierungslisten).
 * Manuell gesetzte Nummern bleiben fix und werden zuerst reserviert; Auto-Einträge
 * (newBadgeNumber = null) erhalten die aktuell nächste freie Nummer im Rangbereich —
 * in Eintragsreihenfolge, damit Vorschau und Durchführung dieselben Nummern ergeben.
 * null im Ergebnis bedeutet: Agent behält seine aktuelle Dienstnummer.
 */
export function resolveEntryBadgeNumbers(
  entries: RankChangeBadgeEntry[],
  allAgents: { badgeNumber: string }[],
  blacklisted: { badgeNumber: string }[],
  prefix: string
): Map<string, string | null> {
  const used = collectUsedBadgeInts(allAgents, prefix)
  for (const row of blacklisted) {
    const n = parseBadgeNumberToInt(row.badgeNumber, prefix)
    if (n !== null) used.add(n)
  }
  const result = new Map<string, string | null>()
  for (const entry of entries) {
    const manual = entry.newBadgeNumber?.trim()
    if (!manual) continue
    const badge = normalizeBadgeNumber(manual, prefix)
    const n = parseBadgeNumberToInt(badge, prefix)
    // Manuelle Nummer aus einer älteren Liste kann inzwischen vergeben sein →
    // Eintrag fällt auf die automatische Neuvergabe zurück.
    const current = parseBadgeNumberToInt(entry.agent.badgeNumber, prefix)
    if (n !== null && n !== current && used.has(n)) continue
    if (n !== null) used.add(n)
    result.set(entry.id, badge)
  }
  for (const entry of entries) {
    if (result.has(entry.id)) continue
    if (!rankHasBadgeRange(entry.proposedRank)) {
      result.set(entry.id, null)
      continue
    }
    const current = parseBadgeNumberToInt(entry.agent.badgeNumber, prefix)
    let assigned = findNextFreeBadgeInRange(entry.proposedRank.badgeMin, entry.proposedRank.badgeMax, used, current)
    // Bereich voll → zur Not über das Bereichsmaximum hinaus weiterzählen
    if (assigned === null) assigned = findNextFreeBadgeFrom(entry.proposedRank.badgeMax + 1, used, current)
    if (assigned === null) {
      result.set(entry.id, null)
    } else {
      used.add(assigned)
      result.set(entry.id, formatBadgeNumber(assigned, prefix))
    }
  }
  return result
}

/**
 * Liefert die nächste freie Dienstnummer für einen Rang, oder null wenn kein Bereich / voll.
 */
export function nextBadgeForRank(
  rank: Pick<Rank, 'badgeMin' | 'badgeMax'>,
  allAgents: { badgeNumber: string }[],
  prefix: string,
  currentAgentBadge?: string | null,
  reservedBadges: { badgeNumber: string }[] = []
): { num: number; str: string } | null {
  if (!rankHasBadgeRange(rank)) return null
  const used = collectUsedBadgeInts(allAgents, prefix)
  const self = currentAgentBadge ? parseBadgeNumberToInt(currentAgentBadge, prefix) : null
  if (self !== null) used.delete(self)
  for (const reserved of reservedBadges) {
    const n = parseBadgeNumberToInt(reserved.badgeNumber, prefix)
    if (n !== null) used.add(n)
  }
  const n = findNextFreeBadgeInRange(rank.badgeMin, rank.badgeMax, used, null)
  if (n === null) return null
  let width = 2
  for (const row of [...allAgents, ...reservedBadges]) {
    const raw = badgeNumberRawDigits(row.badgeNumber, prefix)
    if (raw === null) continue
    const value = parseInt(raw, 10)
    if (value >= rank.badgeMin && value <= rank.badgeMax && raw.length > width) {
      width = raw.length
    }
  }
  return { num: n, str: formatBadgeNumberWithWidth(n, prefix, width) }
}

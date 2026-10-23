/**
 * Stufen der Fehlzeit-Automatik – ohne DB, damit die Regeln testbar bleiben.
 *   ab 3 Tagen: lila + negativer Eintrag + DM
 *   ab 7 Tagen: gelb + Status „Inaktiv“ + System-Notiz
 */

export type AutomationFlag = 'RED' | 'ORANGE' | 'YELLOW' | 'BLUE' | 'PURPLE'
export type InactivityTier = 'active' | 'warning' | 'inactive'

export const INACTIVITY_WARNING_DAYS = 3
export const INACTIVITY_DAYS = 7
/** Ältere Fehlzeiten bekommen keinen rückwirkenden Eintrag (sonst DM-Welle beim Rollout). */
const INACTIVITY_ENTRY_MAX_AGE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Farben, die nur die Automatik setzt und daher auch wieder entfernt. */
const AUTOMATIC_FLAGS = new Set<AutomationFlag>(['BLUE', 'YELLOW', 'PURPLE'])

export function inactivityTier(lastActivity: Date, now: Date): InactivityTier {
  const idleMs = now.getTime() - lastActivity.getTime()
  if (idleMs > INACTIVITY_DAYS * DAY_MS) return 'inactive'
  if (idleMs > INACTIVITY_WARNING_DAYS * DAY_MS) return 'warning'
  return 'active'
}

export function nextAgentFlag(current: AutomationFlag | null, hasAbsence: boolean, tier: InactivityTier): AutomationFlag | null {
  if (hasAbsence) return 'BLUE'
  if (tier === 'inactive') return 'YELLOW'
  if (tier === 'warning') return 'PURPLE'
  return current && AUTOMATIC_FLAGS.has(current) ? null : current
}

export function shouldCreateInactivityEntry(input: {
  tier: InactivityTier
  hasAbsence: boolean
  lastActivity: Date
  lastEntryAt: Date | null
  now: Date
}) {
  if (input.hasAbsence || input.tier === 'active') return false
  if (input.now.getTime() - input.lastActivity.getTime() > INACTIVITY_ENTRY_MAX_AGE_DAYS * DAY_MS) return false
  // Pro Inaktivitätsphase (seit der letzten Aktivität) genau ein Eintrag.
  return !input.lastEntryAt || input.lastEntryAt < input.lastActivity
}

/** Reine Hilfsfunktionen für „Agent des Monats“ – ohne Datenbank, auch im Client nutzbar. */

const TIME_ZONE = 'Europe/Berlin'

/** Monatsschlüssel "YYYY-MM" in deutscher Zeit, damit die Abstimmung um Mitternacht MEZ/MESZ wechselt. */
export function monthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function shiftMonthKey(key: string, offset: number): string {
  const [year, month] = key.split('-').map(Number)
  const index = year * 12 + (month - 1) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function monthKeyLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  // Mittag UTC: fällt in jeder Zeitzone sicher in denselben Monat.
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15, 12)))
}

export type VoteTally = { agentId: string; votes: number }

/** Alle Agents mit den meisten Stimmen; leer, wenn niemand abgestimmt hat. */
export function monthWinners(tally: VoteTally[]): VoteTally[] {
  const top = Math.max(0, ...tally.map((row) => row.votes))
  if (top === 0) return []
  return tally.filter((row) => row.votes === top)
}

/** Grund, warum eine Stimme nicht zählt – oder `null`, wenn sie gültig ist. */
export function voteRejection(input: { voterAgentId: string | null; nomineeAgentId: string; nomineeActive: boolean }): string | null {
  if (!input.voterAgentId) return 'Abstimmen können nur Nutzer mit verknüpftem Agent.'
  if (input.voterAgentId === input.nomineeAgentId) return 'Für dich selbst kannst du nicht abstimmen.'
  if (!input.nomineeActive) return 'Für diesen Agent kann nicht abgestimmt werden.'
  return null
}

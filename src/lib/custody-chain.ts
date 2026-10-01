/**
 * Hash-Verkettung der Beweiskette. Jeder Eintrag hasht seinen Inhalt zusammen
 * mit dem Hash des Vorgängers. Wer nachträglich in der Datenbank einen Eintrag
 * ändert, löscht oder einschiebt, bricht die Kette ab dieser Stelle.
 *
 * Nur serverseitig importieren (`node:crypto`).
 */
import { createHash } from 'node:crypto'

import type { CustodyIntegrity } from '@/lib/custody'

export interface CustodyHashInput {
  chainKey: string
  evidenceId: string | null
  itemNumber: string
  investigationId: string
  action: string
  actorId: string | null
  actorName: string
  fromHolder: string | null
  toHolder: string | null
  location: string | null
  note: string | null
  createdAt: Date
}

/** Feste Feldreihenfolge – ein JSON-Objekt hätte keine garantierte Reihenfolge. */
export function custodyHash(prevHash: string | null, input: CustodyHashInput) {
  const canonical = JSON.stringify([
    prevHash ?? '',
    input.chainKey,
    input.itemNumber,
    input.investigationId,
    input.action,
    input.actorId ?? '',
    input.actorName,
    input.fromHolder ?? '',
    input.toHolder ?? '',
    input.location ?? '',
    input.note ?? '',
    input.createdAt.toISOString(),
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export type StoredCustodyEvent = CustodyHashInput & { id: string; prevHash: string | null; hash: string }

/**
 * Bringt eine Kette über die Hash-Verweise in Reihenfolge und prüft sie.
 * Gezählt wird nicht nach Zeitstempel (gleiche Millisekunde ist möglich),
 * sondern entlang `prevHash → hash`. Gabelungen, Lücken, verwaiste oder
 * veränderte Einträge machen die Kette ungültig; sie stehen dann – nach Zeit
 * sortiert – am Ende, damit nichts verschwindet.
 *
 * `evidenceId` fließt bewusst nicht in den Hash ein: es wird beim Löschen des
 * Asservats auf `null` gesetzt.
 */
export function orderCustodyChain<T extends StoredCustodyEvent>(
  events: readonly T[],
): { ordered: T[]; integrity: CustodyIntegrity } {
  if (events.length === 0) return { ordered: [], integrity: { valid: true, brokenAtId: null } }

  const byPrev = new Map<string, T[]>()
  for (const event of events) {
    const key = event.prevHash ?? ''
    const list = byPrev.get(key) ?? []
    list.push(event)
    byPrev.set(key, list)
  }

  const ordered: T[] = []
  const visited = new Set<string>()
  let brokenAtId: string | null = null
  let previous: string | null = null

  for (;;) {
    const candidates: T[] = byPrev.get(previous ?? '') ?? []
    if (candidates.length === 0) break
    const [next, ...forks] = candidates
    if (forks.length > 0 && !brokenAtId) brokenAtId = forks[0].id
    if (custodyHash(previous, next) !== next.hash && !brokenAtId) brokenAtId = next.id
    if (visited.has(next.id)) break
    visited.add(next.id)
    ordered.push(next)
    previous = next.hash
  }

  const leftovers = events
    .filter((event) => !visited.has(event.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  if (leftovers.length > 0 && !brokenAtId) brokenAtId = leftovers[0].id

  return { ordered: [...ordered, ...leftovers], integrity: { valid: brokenAtId === null, brokenAtId } }
}

/**
 * Umwandlung der alten Unterakten (`Dossier.kind = 'FILE'`) in Einsatzakten
 * (`Investigation`). Beides beschrieb denselben Vorgang – einen Einsatz, der zu
 * einer Dauerakte gehört – nur in zwei Tabellen.
 *
 * Bewusst ohne Prisma-Import: die Entscheidungen (welcher Anker, welcher Text,
 * welcher Freigabe-Eintrag) sind reine Funktionen und damit ohne Datenbank
 * prüfbar. Das Skript unter `scripts/migrate-unterakten-to-einsatzakten.ts`
 * liefert nur die Zeilen und schreibt das Ergebnis zurück.
 */

export const FILE_KIND = 'FILE'

/** Maximale Tiefe wie in `validateDossierParent` – darüber ist der Baum kaputt. */
const MAX_DEPTH = 30

export type MigratableDossier = { id: string; kind: string; parentId: string | null }

/**
 * Die nächste Akte oberhalb von `id`, die keine Unterakte ist. Dort wird die
 * neue Einsatzakte eingehängt. `null` bedeutet: es gibt keine Dauerakte darüber,
 * die Einsatzakte steht danach frei.
 *
 * Der Zyklenschutz ist kein Selbstzweck – `validateDossierParent` verhindert
 * Zyklen nur beim Speichern über die API, Altdaten können ältere Wege genommen
 * haben. Ein Zyklus darf die Migration nicht aufhängen.
 */
export function resolveAnchor(id: string, byId: Map<string, MigratableDossier>): string | null {
  const visited = new Set<string>([id])
  let current = byId.get(id)?.parentId ?? null
  while (current) {
    if (visited.has(current) || visited.size >= MAX_DEPTH) return null
    visited.add(current)
    const parent = byId.get(current)
    if (!parent) return null
    if (parent.kind !== FILE_KIND) return parent.id
    current = parent.parentId
  }
  return null
}

export type MigrationPlan = {
  /** Unterakten, die zu Einsatzakten werden, samt Ziel-Dauerakte. */
  conversions: { id: string; anchorId: string | null }[]
  /** Akten, die unter einer Unterakte hingen und hochgezogen werden müssen. */
  reparents: { id: string; parentId: string | null }[]
}

/**
 * `Dossier.parent` steht auf `onDelete: Restrict`. Kinder müssen deshalb
 * umgehängt sein, bevor die Unterakte gelöscht werden kann – sonst bricht der
 * Lauf mittendrin ab und hinterlässt einen halb migrierten Bestand.
 */
export function planDossierMigration(dossiers: MigratableDossier[]): MigrationPlan {
  const byId = new Map(dossiers.map(row => [row.id, row]))
  const conversions = dossiers
    .filter(row => row.kind === FILE_KIND)
    .map(row => ({ id: row.id, anchorId: resolveAnchor(row.id, byId) }))
  const reparents = dossiers
    .filter(row => row.kind !== FILE_KIND && row.parentId && byId.get(row.parentId)?.kind === FILE_KIND)
    .map(row => ({ id: row.id, parentId: resolveAnchor(row.parentId!, byId) }))
  return { conversions, reparents }
}

/**
 * `Investigation` hat kein Adressfeld. Die Adresse als eigene Zeile in die
 * Zusammenfassung zu schreiben ist verlustfrei genug und bleibt durchsuchbar;
 * ein neues Feld nur für Altdaten wäre Ballast.
 */
export function migratedSummary(description: string | null, address: string | null): string | null {
  const parts: string[] = []
  const text = description?.trim()
  const location = address?.trim()
  if (text) parts.push(text)
  if (location) parts.push(`Adresse: ${location}`)
  return parts.length ? parts.join('\n\n') : null
}

export type ShareItemRow = { id: string; shareId: string; kind: string; recordId: string }
export type MigratedRecord = { investigationId: string; title: string }

export type ShareRewritePlan = {
  updates: { id: string; kind: 'CASE'; recordId: string; title: string }[]
  deletes: string[]
}

/**
 * `RecordShareItem` hat keinen Fremdschlüssel auf `Dossier` – es speichert nur
 * `kind` und `recordId` als Text. Ohne dieses Nachziehen zeigt jeder bestehende
 * Freigabelink, der eine Unterakte enthält, nach der Migration ins Leere und
 * beantwortet den Abruf mit 403.
 *
 * `existingKeys` enthält die bereits belegten `<shareId>:CASE:<recordId>` und
 * schützt den Unique-Index `[shareId, kind, recordId]`: enthält dieselbe
 * Freigabe die Ziel-Einsatzakte schon, wird der alte Eintrag gelöscht statt
 * doppelt angelegt.
 */
export function planShareItemRewrites(
  items: ShareItemRow[],
  mapping: Map<string, MigratedRecord>,
  existingKeys: Set<string>,
): ShareRewritePlan {
  const plan: ShareRewritePlan = { updates: [], deletes: [] }
  const claimed = new Set(existingKeys)
  for (const item of items) {
    if (item.kind !== 'DOSSIER') continue
    const target = mapping.get(item.recordId)
    if (!target) continue
    const key = `${item.shareId}:CASE:${target.investigationId}`
    if (claimed.has(key)) {
      plan.deletes.push(item.id)
      continue
    }
    claimed.add(key)
    plan.updates.push({ id: item.id, kind: 'CASE', recordId: target.investigationId, title: target.title })
  }
  return plan
}

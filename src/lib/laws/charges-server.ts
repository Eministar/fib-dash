import { MAX_CHARGES, type Charge } from '../investigations/charges'
import { getLaws, type LawCatalog, type NormEntry } from './laws'

export const chargeOf = (norm: NormEntry): Charge => ({ ref: norm.ref, label: norm.label, title: norm.title })

/**
 * Eingaben aus Formular oder KI gegen das Gesetzbuch prüfen. Akzeptiert
 * `{ ref }`-Objekte und Fundstellen als Text; Unbekanntes wird verworfen.
 */
export async function normalizeCharges(value: unknown, catalog?: LawCatalog): Promise<Charge[]> {
  if (!Array.isArray(value) || !value.length) return []
  const laws = catalog ?? await getLaws()
  const seen = new Set<string>()
  const result: Charge[] = []
  for (const item of value) {
    const ref = typeof item === 'string' ? item : item && typeof item === 'object' && typeof (item as { ref?: unknown }).ref === 'string' ? (item as { ref: string }).ref : ''
    const norm = laws.resolve(ref)
    if (!norm || seen.has(norm.ref)) continue
    seen.add(norm.ref)
    result.push(chargeOf(norm))
    if (result.length >= MAX_CHARGES) break
  }
  return result
}

/** Kompakte Liste aller strafbewehrten Normen für den KI-Prompt: `stgb:p9 = § 9 StGB Diebstahl`. */
export async function penalCatalogForPrompt() {
  const laws = await getLaws()
  return laws.norms.filter((norm) => norm.penal && norm.title).map((norm) => `${norm.ref} = ${norm.label} ${norm.title}`).join('\n')
}

/** Normtexte zu Straftatbeständen – für Anlagen und Freigaben. */
export async function chargeTexts(charges: Charge[]) {
  if (!charges.length) return []
  const laws = await getLaws()
  return charges.map((charge) => {
    const norm = laws.find(charge.ref)
    return { ...charge, text: norm?.text ?? null, url: norm?.url ?? null }
  })
}

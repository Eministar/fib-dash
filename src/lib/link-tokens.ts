/**
 * Normalisiert einen Token aus einer geteilten Link-URL.
 *
 * Links werden in der Praxis über Discord, WhatsApp oder Copy-Paste
 * weitergegeben. Dabei landet regelmäßig mehr im Adressfeld als der reine
 * Token: die komplette URL, ein angehängter Punkt am Satzende, ein Zeilenumbruch
 * oder URL-Encoding. Ohne diese Bereinigung endet all das in einem
 * „nicht gefunden“, obwohl der Link eigentlich gültig ist.
 *
 * Es bleiben nur base64url-Zeichen übrig — genau der Zeichenvorrat, aus dem die
 * App ihre Tokens erzeugt.
 */
export function normalizeLinkToken(raw: string | null | undefined) {
  if (typeof raw !== 'string') return ''

  let value = raw.trim()
  try {
    value = decodeURIComponent(value)
  } catch {
    // Kein gültiges Encoding — Rohwert weiterverwenden.
  }

  // Nur der letzte Pfadabschnitt zählt, falls jemand die ganze URL einfügt.
  const lastSegment = value.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? ''
  return lastSegment.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128)
}

/**
 * Wohin ein Nutzer ohne Dashboard-Rechte gehoert.
 *
 * Bewusst als reine Funktion und nicht in der Shell: die Entscheidung haengt an
 * einer asynchronen Abfrage, und genau daran ist sie vorher gescheitert. Hier
 * ist sie ohne React pruefbar.
 */

/**
 * Der Stand der Bodycam-Abfrage.
 *
 * `pending` ist der Grund, warum es diesen Typ gibt: `useFetch` meldet
 * `loading === false`, bevor es eine URL bekommen hat, und kann "noch nicht
 * gefragt" nicht von "fertig" unterscheiden. Wer das verwechselt, liest ein
 * fehlendes Ergebnis als "kein Zugriff" und leitet um, bevor die Antwort da
 * ist.
 */
export type BodycamAnswer = 'pending' | 'allowed' | 'denied'

export interface VisitorRoutingInput {
  /** Keine Rechte ausser `password:change`. */
  visitorOnly: boolean
  bodycam: BodycamAnswer
  isBodycamCatalog: boolean
  isSharedFormTestLink: boolean
}

/** Das Umleitungsziel, oder `null` wenn der Nutzer bleiben darf. */
export function visitorRedirectTarget(input: VisitorRoutingInput): string | null {
  if (!input.visitorOnly) return null

  // Ein geteilter Testlink ist keine regulaere Dashboard-Seite: Bewerber und
  // frisch eingeladene Agent haben dort noch gar keine Rechte.
  if (input.isSharedFormTestLink) return null

  // Ohne Antwort wird nicht entschieden. Die Shell zeigt in dieser Zeit ihren
  // Loader.
  if (input.bodycam === 'pending') return null

  // Katalog-Leser bleiben im Dashboard, aber ausschliesslich im Katalog.
  if (input.bodycam === 'allowed') {
    return input.isBodycamCatalog ? null : '/investigations/clips'
  }

  return '/besucherportal'
}

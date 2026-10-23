/**
 * Anzeige-Label (semver + Status). Bei Release `package.json` `"version"` anpassen.
 */
export const APP_VERSION_LABEL = '1.1.3'

/**
 * Stabiler Bezeichner des aktuell ausgelieferten Commits.
 *
 * `next.config.ts` injiziert die SHA beim Build. Der Fallback ist bewusst
 * nicht mehr `local`: Auch ein lokaler Build bleibt damit eindeutig einem
 * Commit zugeordnet (oder wird transparent als `unknown` markiert).
 */
export function releaseBuildId(): string {
  const bid =
    typeof process.env.NEXT_PUBLIC_BUILD_ID === 'string' ? process.env.NEXT_PUBLIC_BUILD_ID.trim() : ''

  if (!bid || bid.toLowerCase() === 'local') return 'unknown'
  return bid
}

/** Anzeige-Kürzel der Build-ID für Footer und Release-Historie. */
export function releaseBuildShort(): string {
  const bid = releaseBuildId()
  if (bid === 'unknown') return 'build-unknown'
  const short = bid.length <= 10 ? bid : bid.slice(0, 10)
  return `build-${short}`
}

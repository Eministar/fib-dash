/** Öffentliches GitHub-Repository, optional per `NEXT_PUBLIC_GITHUB_URL`. */
export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL?.trim() ?? ''

function firstForwardedValue(value: string | null | undefined) {
  return value?.split(',')[0]?.trim() || ''
}

/**
 * Öffentliche Basis-URL der App — für Links, die die App verlässt (Discord-DMs,
 * OAuth-Redirects). `NEXT_PUBLIC_SITE_URL` gewinnt immer; ohne diesen Wert wird
 * aus den Proxy-Headern rekonstruiert.
 */
export function resolveBaseUrl(req?: { url: string; headers: Headers }) {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  if (!req) return ''

  const requestUrl = new URL(req.url)
  const host =
    firstForwardedValue(req.headers.get('x-forwarded-host')) ||
    req.headers.get('host') ||
    requestUrl.host
  const proto =
    firstForwardedValue(req.headers.get('x-forwarded-proto')) ||
    requestUrl.protocol.replace(':', '') ||
    'https'

  return host ? `${proto}://${host}` : ''
}

/** Persönlicher Vertragslink eines Agents. */
export function contractUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, '')}/vertrag/${token}`
}

/**
 * Link zu einem Versetzungsantrag. Anders als der Vertragslink ist dieser
 * bewusst ohne Anmeldung erreichbar — die entgegennehmende Behörde hat keinen
 * Account im Dashboard.
 */
export function transferRequestUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, '')}/versetzung/${token}`
}

/**
 * Link zu einer Klageschrift der Legal Affairs Division. Anders als ein
 * Vertragslink ist dieser bewusst ohne Anmeldung erreichbar — jeder mit dem
 * Link darf die Klageschrift einsehen.
 */
export function legalCaseUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, '')}/klage/${token}`
}

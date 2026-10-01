/**
 * Konfiguration der LSPD-Anbindung. Eigenes Modul ohne `server-only`, damit
 * die Auswertung testbar bleibt; das Secret liest nur der Server.
 */
export function lspdConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.LSPD_HR_API_URL?.trim().replace(/\/+$/, '') ?? ''
  const secret = env.LSPD_HR_API_SECRET?.trim() ?? ''
  return url && secret ? { url, secret } : null
}

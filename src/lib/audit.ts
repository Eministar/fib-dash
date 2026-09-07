import { prisma } from './prisma'
import type { CurrentAuth } from './auth'

interface AuditLogParams {
  action: string
  userId: string | null | undefined
  agentId?: string
  oldValue?: string
  newValue?: string
  details?: string
  /**
   * Optional: Auth-Kontext des Aufrufers. Wenn gesetzt und nicht 'cookie',
   * wird der Auth-Methode automatisch den Details vorangestellt
   * (z. B. "via API Token 'Discord-Bot' (fib_p4A8xKz…) on behalf of Discord ID 12345 (Erika)").
   */
  auth?: CurrentAuth
}

export async function createAuditLog(params: AuditLogParams) {
  const details = enrichDetailsWithAuth(params.auth, params.details)
  return prisma.auditLog.create({
    data: {
      action: params.action,
      userId: params.userId || null,
      agentId: params.agentId || null,
      oldValue: params.oldValue || null,
      newValue: params.newValue || null,
      details,
    }
  })
}

function enrichDetailsWithAuth(auth: CurrentAuth | undefined, originalDetails: string | undefined): string | null {
  const via = formatAuthActor(auth)
  if (!via) return originalDetails ?? null
  return originalDetails ? `${originalDetails} · ${via}` : via
}

/**
 * Liefert eine kompakte Beschreibung des Auth-Akteurs, z. B. für Audit-Logs.
 * - Cookie:    "Cookie <displayName>"
 * - API-Token: "API Token '<name>' (<prefix>) by <displayName>"
 * - ...with impersonation: "... on behalf of <impersonated-displayName> (Discord <id>)"
 */
export function formatAuthActor(auth: CurrentAuth | undefined): string {
  if (!auth) return ''
  if (auth.kind === 'cookie') return `Cookie ${auth.user.displayName}`
  if (auth.kind === 'api' && auth.api) {
    const base = `API Token "${auth.api.tokenName}" (${auth.api.tokenPrefix}) by ${auth.api.tokenOwnerDisplayName}`
    if (auth.impersonation) {
      return `${base} on behalf of ${auth.impersonation.displayName} (Discord ${auth.impersonation.discordId})`
    }
    return base
  }
  return auth.user.displayName
}

import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { jwtSecret } from '@/lib/auth'
import { createApiToken } from '@/lib/core/api-tokens'
import type { Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

/**
 * Anmeldung der Desktop-App (Loopback-Flow nach RFC 8252 mit PKCE):
 *
 * 1. Die App öffnet `/desktop-connect?port=…&state=…&challenge=…` im Browser.
 * 2. Der angemeldete Nutzer bestätigt; das Dashboard stellt einen kurzlebigen
 *    Code aus und leitet ihn an `http://127.0.0.1:<port>/callback` weiter.
 * 3. Die App tauscht Code + Verifier gegen einen API-Token.
 *
 * Wer nur den Code abfängt, kann ohne den Verifier nichts damit anfangen.
 */

const CODE_AUDIENCE = 'fib-desktop-connect'
const CODE_TTL_SECONDS = 120
const TOKEN_TTL_DAYS = 180

/**
 * Leere Liste = alle Rechte des Kontos, wie eine Browser-Sitzung: Die App deckt
 * nach und nach dieselben Bereiche ab wie das Dashboard (Clips, Dienstzeiten, Akten).
 */
export const DESKTOP_TOKEN_SCOPES: Permission[] = []

export const DESKTOP_TOKEN_PREFIX = 'FIB Desktop · '

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isValidChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_PATTERN.test(value)
}

export function isValidLoopbackPort(value: unknown) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

function challengeFor(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function issueConnectCode(userId: string, challenge: string) {
  return jwt.sign({ sub: userId, chal: challenge }, jwtSecret(), {
    audience: CODE_AUDIENCE,
    expiresIn: CODE_TTL_SECONDS,
    algorithm: 'HS256',
  })
}

// Eingelöste Codes bis zu ihrem Ablauf merken, damit jeder nur einmal gilt.
const redeemedCodes = new Map<string, number>()

function rememberRedeemed(code: string, expiresAtMs: number) {
  const now = Date.now()
  for (const [key, expiry] of redeemedCodes) if (expiry < now) redeemedCodes.delete(key)
  redeemedCodes.set(code, expiresAtMs)
}

export class DesktopAuthError extends Error {}

/** Prüft Code und Verifier und gibt einen neuen API-Token für dieses Gerät aus. */
export async function redeemConnectCode(code: string, verifier: string, deviceName: string) {
  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(code, jwtSecret(), { audience: CODE_AUDIENCE, algorithms: ['HS256'] }) as jwt.JwtPayload
  } catch {
    throw new DesktopAuthError('Der Anmeldecode ist ungültig oder abgelaufen')
  }
  if (redeemedCodes.has(code)) throw new DesktopAuthError('Der Anmeldecode wurde bereits verwendet')
  if (typeof payload.sub !== 'string' || payload.chal !== challengeFor(verifier)) {
    throw new DesktopAuthError('Der Anmeldecode passt nicht zu dieser App')
  }
  rememberRedeemed(code, (payload.exp ?? 0) * 1000)

  const name = `${DESKTOP_TOKEN_PREFIX}${deviceName}`.slice(0, 80)
  // Meldet sich dasselbe Gerät erneut an, ersetzt der neue Token den alten.
  await prisma.apiToken.updateMany({
    where: { userId: payload.sub, name, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'Durch neue Anmeldung der Desktop-App ersetzt' },
  })

  const { plaintext } = await createApiToken({
    name,
    userId: payload.sub,
    scopes: DESKTOP_TOKEN_SCOPES,
    expiresAt: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  })
  return plaintext
}

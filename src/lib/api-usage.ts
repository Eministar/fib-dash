import { prisma } from './prisma'
import type { CurrentAuth } from './auth'

const USAGE_WRITE_THROTTLE_MS = 60_000

export interface UsageContext {
  method: string
  path: string
  statusCode: number
  durationMs: number
  userAgent?: string | null
  ip?: string | null
}

/**
 * Aktualisiert lastUsedAt throttled (Counter wird bei jedem Aufruf
 * inkrementiert) und persistiert einen detaillierten Usage-Eintrag.
 * Beide Operationen sind fire-and-forget — Fehler schlucken wir.
 */
export async function recordApiTokenUsage(auth: CurrentAuth, ctx: UsageContext): Promise<void> {
  if (auth.kind !== 'api' || !auth.api) return
  const tokenId = auth.api.tokenId

  // 1) Last-used / counter (throttled)
  void (async () => {
    try {
      const row = await prisma.apiToken.findUnique({
        where: { id: tokenId },
        select: { lastUsedAt: true },
      })
      if (!row) return
      const now = new Date()
      if (row.lastUsedAt && now.getTime() - row.lastUsedAt.getTime() < USAGE_WRITE_THROTTLE_MS) {
        await prisma.apiToken.update({
          where: { id: tokenId },
          data: { usageCount: { increment: 1 } },
        })
      } else {
        await prisma.apiToken.update({
          where: { id: tokenId },
          data: { lastUsedAt: now, usageCount: { increment: 1 } },
        })
      }
    } catch {
      // tracking failure must never break the request
    }
  })()

  // 2) Detaillierter Log
  void (async () => {
    try {
      await prisma.apiTokenUsage.create({
        data: {
          tokenId,
          method: ctx.method,
          path: ctx.path,
          statusCode: ctx.statusCode,
          durationMs: ctx.durationMs,
          userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 200) : null,
          ip: ctx.ip ? ctx.ip.slice(0, 64) : null,
        },
      })
    } catch {
      // ignore
    }
  })()
}

export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return headers.get('x-real-ip') || null
}

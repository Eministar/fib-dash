import { NextRequest } from 'next/server'
import { z } from 'zod'
import { sendDiscordWebhookEvent } from '@/lib/discord-webhook'
import { success, error } from '@/lib/api-response'

const runtimeEventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(1200).optional(),
  digest: z.string().trim().max(160).optional(),
  path: z.string().trim().max(300).optional(),
  stack: z.string().trim().max(2000).optional(),
})

/**
 * Dieser Endpunkt ist bewusst ohne Login erreichbar — clientseitige Fehler
 * treten auch auf Login- und Fehlerseiten auf, also gerade dann, wenn keine
 * Session existiert.
 *
 * Genau deshalb braucht er eine Bremse: ohne Limit könnte jeder den
 * Discord-Webhook des Departments mit beliebigem Text fluten. Das Fenster ist
 * pro Prozess und pro IP; für den eigentlichen Zweck (ein paar Fehlermeldungen
 * pro Nutzer) reicht das locker aus.
 */
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_EVENTS = 5
const recentEvents = new Map<string, number[]>()

function clientKey(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

function isRateLimited(key: string, now = Date.now()) {
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const hits = (recentEvents.get(key) ?? []).filter((timestamp) => timestamp > windowStart)

  if (hits.length >= RATE_LIMIT_MAX_EVENTS) {
    recentEvents.set(key, hits)
    return true
  }

  hits.push(now)
  recentEvents.set(key, hits)

  // Aufräumen, damit die Map bei vielen unterschiedlichen IPs nicht wächst.
  if (recentEvents.size > 500) {
    for (const [entryKey, timestamps] of recentEvents) {
      if (timestamps.every((timestamp) => timestamp <= windowStart)) recentEvents.delete(entryKey)
    }
  }

  return false
}

export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(clientKey(req))) {
      // 202 statt 429: der Client meldet nur Fehler und soll deswegen nicht
      // selbst in eine Fehlerbehandlung laufen.
      return success({ ok: true, throttled: true }, 202)
    }

    const parsed = runtimeEventSchema.safeParse(await req.json())
    if (!parsed.success) return error('Ungültiges Runtime-Event')

    await sendDiscordWebhookEvent({
      title: parsed.data.title,
      description: parsed.data.message || 'Clientseitiger Fehler wurde gemeldet.',
      severity: 'error',
      source: 'client-runtime',
      fields: [
        { name: 'Pfad', value: parsed.data.path || req.nextUrl.pathname, inline: true },
        ...(parsed.data.digest
          ? [{ name: 'Digest', value: parsed.data.digest, inline: true }]
          : []),
        ...(parsed.data.stack ? [{ name: 'Stack', value: parsed.data.stack }] : []),
      ],
    })

    return success({ ok: true })
  } catch {
    return error('Runtime-Event konnte nicht verarbeitet werden', 500)
  }
}

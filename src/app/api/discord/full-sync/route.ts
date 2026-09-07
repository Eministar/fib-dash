import { requireAuth } from '@/lib/auth'
import { error, unauthorized } from '@/lib/api-response'
import { syncAllAgentDiscordRoles } from '@/lib/discord-integration'

export async function POST() {
  try {
    await requireAuth(['ADMIN'], ['settings:manage'])

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
        }

        try {
          const result = await syncAllAgentDiscordRoles({
            onProgress: (progress) => send({ type: 'progress', progress }),
          })

          send({
            type: 'done',
            data: {
              message: `Discord-Sync abgeschlossen: ${result.synced} synchronisiert, ${result.skipped} übersprungen (keine Discord-ID), ${result.failed} fehlgeschlagen`,
              ...result,
            },
          })
        } catch (e: unknown) {
          send({
            type: 'error',
            error: e instanceof Error ? e.message : 'Serverfehler',
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { registerDiscordCommands } from '@/lib/discord-commands'

export async function POST() {
  try {
    await requireAuth(['ADMIN'], ['settings:manage'])
    const commands = await registerDiscordCommands()
    return success({ message: 'Discord-Commands registriert', commands })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}


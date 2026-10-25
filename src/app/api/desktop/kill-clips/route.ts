import { readFile, unlink } from 'node:fs/promises'
import { z } from 'zod'
import { getCurrentAuth, type CurrentUser } from '@/lib/auth'
import { error as badRequest, success, unauthorized } from '@/lib/api-response'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { DiscordApiError, findAgentClipChannel, guildUploadLimitBytes, postDiscordFile } from '@/lib/discord/discord-integration'
import { killClipMessage } from '@/lib/discord/kill-clip-message'
import { routeError } from '@/lib/investigations/investigations-server'
import { consumeUploadSession, UploadSessionError } from '@/lib/media/upload-sessions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function ownAgent(user: CurrentUser) {
  return prisma.agent.findFirst({
    where: {
      status: { not: 'TERMINATED' },
      OR: [{ userId: user.id }, ...(user.discordId ? [{ discordId: user.discordId }] : [])],
    },
    select: { id: true, firstName: true, lastName: true, badgeNumber: true },
  })
}

/**
 * Wohin die Kill-Clips der Desktop-App gehen: der eigene Clips-Channel und die
 * Dateigröße, die Discord dort annimmt (die App rendert passend darunter).
 */
export async function GET() {
  try {
    const auth = await getCurrentAuth()
    if (!auth) return unauthorized()
    const agent = await ownAgent(auth.user)
    if (!agent) return success({ channel: null, limitBytes: 0, reason: 'Dein Konto ist mit keinem Agent verknüpft.' })
    const [channel, limitBytes] = await Promise.all([findAgentClipChannel(agent.id), guildUploadLimitBytes()])
    return success({
      channel: channel ? { name: channel.name } : null,
      limitBytes,
      reason: channel ? null : 'Für dich gibt es noch keinen Clips-Channel. Ein Admin kann ihn im Dashboard unter Discord anlegen.',
    })
  } catch (cause) {
    return routeError(cause)
  }
}

const bodySchema = z.object({
  uploadId: z.string().trim().min(1).max(64),
  /** Zeitpunkt des ersten und letzten Kills (ISO). */
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  kills: z.number().int().min(1).max(500),
  /** Namen der Getöteten aus dem Kill-Feed. */
  victims: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  /** Teil x von y, wenn eine Serie auf mehrere Videos verteilt werden musste. */
  part: z.number().int().min(1).max(50).default(1),
  parts: z.number().int().min(1).max(50).default(1),
})

/** Übernimmt einen fertigen Upload und postet ihn als Bot in den eigenen Clips-Channel. */
export async function POST(request: Request) {
  try {
    const auth = await getCurrentAuth()
    if (!auth) return unauthorized()
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return badRequest('Ungültige Angaben zum Kill-Clip')
    const meta = parsed.data

    const agent = await ownAgent(auth.user)
    if (!agent) return badRequest('Dein Konto ist mit keinem Agent verknüpft.')
    const channel = await findAgentClipChannel(agent.id)
    if (!channel) return badRequest('Für dich gibt es noch keinen Clips-Channel.')

    const content = killClipMessage({
      agentName: `${agent.firstName} ${agent.lastName}`,
      badge: displayBadgeNumber(agent.badgeNumber),
      startedAt: new Date(meta.startedAt),
      endedAt: meta.endedAt ? new Date(meta.endedAt) : null,
      kills: meta.kills,
      victims: meta.victims,
      part: meta.part,
      parts: meta.parts,
    })

    let link = ''
    await consumeUploadSession(meta.uploadId, auth.user.id, 'CLIP', async (source, extension) => {
      const stamp = new Date(meta.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')
      link = await postDiscordFile(channel, content, {
        data: await readFile(source),
        name: `kill-clip-${stamp}${meta.parts > 1 ? `-teil${meta.part}` : ''}${extension}`,
        type: 'video/mp4',
      })
      // Die Datei liegt jetzt in Discord – auf dem Server bleibt nichts zurück.
      await unlink(source).catch(() => {})
      return 'discord'
    })
    return success({ link, channel: channel.name })
  } catch (cause) {
    if (cause instanceof UploadSessionError) return badRequest(cause.message)
    if (cause instanceof DiscordApiError && cause.status === 413) return badRequest('Discord hat die Datei als zu groß abgelehnt.')
    if (cause instanceof DiscordApiError && cause.status === 403) return badRequest('Der Bot darf in deinem Clips-Channel keine Dateien posten.')
    return routeError(cause)
  }
}

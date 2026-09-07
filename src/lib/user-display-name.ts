import { displayBadgeNumber } from '@/lib/badge-number'
import { prisma } from '@/lib/prisma'
import { getBadgePrefix } from '@/lib/settings-helpers'

type UserDisplaySource = {
  displayName: string
  discordId: string | null
}

const DEFAULT_DISPLAY_BADGE_PREFIX = 'FIB-'

/** Marker, der bei aktiver Uprank-Sperre vor den Namen gesetzt wird. */
export const PROMOTION_BLOCK_MARKER = '[X]'

export type LinkedAgentDisplaySource = {
  badgeNumber: string
  firstName: string
  lastName: string
  discordId?: string | null
  status?: string | null
  promotionBlocked?: boolean | null
}

function bracketedBadgeNumber(badgeNumber: string, prefix: string) {
  const displayed = displayBadgeNumber(badgeNumber)
  if (displayed === '—') return ''

  const configuredPrefix = prefix.trim()
  const cleanPrefix = configuredPrefix || DEFAULT_DISPLAY_BADGE_PREFIX
  if (displayed.startsWith(cleanPrefix)) return `[${displayed}]`
  if (!configuredPrefix && /^\D/.test(displayed)) return `[${displayed}]`

  const joined = cleanPrefix.endsWith('-') ? `${cleanPrefix}${displayed}` : `${cleanPrefix}-${displayed}`
  return `[${joined}]`
}

export function formatLinkedAgentDisplayName(agent: LinkedAgentDisplaySource, prefix: string) {
  const name = `${agent.firstName} ${agent.lastName}`.replace(/\s+/g, ' ').trim()
  const marker = agent.promotionBlocked ? PROMOTION_BLOCK_MARKER : ''
  return [marker, bracketedBadgeNumber(agent.badgeNumber, prefix), name].filter(Boolean).join(' ')
}

export async function resolveLinkedAgentDisplayName(discordId: string | null | undefined) {
  const cleanDiscordId = discordId?.trim()
  if (!cleanDiscordId) return null

  const agent = await prisma.agent.findFirst({
    where: {
      discordId: cleanDiscordId,
      status: { not: 'TERMINATED' },
    },
    select: {
      badgeNumber: true,
      firstName: true,
      lastName: true,
      promotionBlocked: true,
    },
  })
  if (!agent) return null

  const displayName = formatLinkedAgentDisplayName(agent, await getBadgePrefix())
  return displayName || null
}

export async function resolveUserDisplayName(user: UserDisplaySource) {
  const displayName = await resolveLinkedAgentDisplayName(user.discordId)
  if (!displayName) return user.displayName

  const discordId = user.discordId?.trim()
  if (discordId && displayName !== user.displayName) {
    await prisma.user.updateMany({
      where: { discordId },
      data: { displayName },
    }).catch((error) => {
      console.error('[UserDisplayName] Anzeigename konnte nicht synchronisiert werden:', error)
    })
  }

  return displayName
}

export async function syncLinkedUserDisplayNameForAgent(agent: LinkedAgentDisplaySource) {
  const discordId = agent.discordId?.trim()
  if (!discordId || agent.status === 'TERMINATED') return null

  const displayName = formatLinkedAgentDisplayName(agent, await getBadgePrefix())
  if (!displayName) return null

  await prisma.user.updateMany({
    where: { discordId },
    data: { displayName },
  })
  return displayName
}

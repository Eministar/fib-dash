import { getCurrentAuth } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { revokeApiToken } from '@/lib/core/api-tokens'
import { DESKTOP_TOKEN_PREFIX } from '@/lib/desktop/desktop-auth'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agents/agent-avatar'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { investigationVisibilityWhere, myInvestigationsWhere } from '@/lib/investigations/investigations'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

const agentSelect = { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true } as const

function agentOption(agent: { id: string; firstName: string; lastName: string; badgeNumber: string }) {
  return { id: agent.id, label: `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})` }
}

/**
 * Alles, was die Desktop-App für das Upload-Formular braucht, in einem Aufruf:
 * wer angemeldet ist, der eigene Agent (für „Bodycam von"), offene Akten und Agents.
 */
export async function GET() {
  try {
    const auth = await getCurrentAuth()
    if (!auth || auth.kind !== 'api') return unauthorized()
    const user = auth.user
    const canUpload = hasPermission(user, 'investigations:manage')

    // Ältere Desktop-Tokens hatten feste Scopes (nur Clips). Sie bekommen beim
    // nächsten Start die Rechte des Kontos, ohne dass sich jemand neu anmelden muss.
    if (auth.api?.tokenName.startsWith(DESKTOP_TOKEN_PREFIX) && !auth.impersonation) {
      const token = await prisma.apiToken.findUnique({ where: { id: auth.api.tokenId }, select: { scopes: true } })
      if (Array.isArray(token?.scopes) && token.scopes.length > 0) {
        await prisma.apiToken.update({ where: { id: auth.api.tokenId }, data: { scopes: [] } })
      }
    }

    const [ownAgent, agents, investigations, mine] = await Promise.all([
      prisma.agent.findFirst({
        where: {
          status: { not: 'TERMINATED' },
          OR: [{ userId: user.id }, ...(user.discordId ? [{ discordId: user.discordId }] : [])],
        },
        select: agentSelect,
      }),
      prisma.agent.findMany({
        where: { status: { not: 'TERMINATED' } },
        select: agentSelect,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      canUpload
        ? prisma.investigation.findMany({
            where: { AND: [investigationVisibilityWhere(user), { status: { in: ['OPEN', 'ACTIVE'] } }] },
            select: { id: true, caseNumber: true, title: true },
            orderBy: { updatedAt: 'desc' },
            take: 300,
          })
        : [],
      canUpload
        ? prisma.investigation.findMany({
            where: { AND: [myInvestigationsWhere(user), { status: { in: ['OPEN', 'ACTIVE'] } }] },
            select: { id: true },
          })
        : [],
    ])
    const mineIds = new Set(mine.map((row) => row.id))
    const avatars = await resolveAgentAvatarUrls(agents)

    return success({
      user: { displayName: user.displayName, avatarUrl: user.avatarUrl },
      /** Damit die App nur anbietet, was das Konto auch darf (Bearbeiten, Löschen …). */
      permissions: user.permissions,
      canUpload,
      tools: {
        bodycam: canUpload,
        dutyTimes: hasPermission(user, 'duty-times:view'),
        investigations: hasPermission(user, 'investigations:view'),
        /** Kill-Clips gehen in den eigenen Clips-Channel – dafür braucht es einen Agent. */
        killClips: !!ownAgent,
      },
      ownAgent: ownAgent ? agentOption(ownAgent) : null,
      agents: agents.map(agentOption),
      /** Discord-Profilbilder je Agent-ID für Team, Chronologie und Listen. */
      agentAvatars: Object.fromEntries(
        agents.flatMap((agent) => {
          const url = agentAvatarUrl(agent, avatars)
          return url ? [[agent.id, url]] : []
        }),
      ),
      investigations: investigations.map((row) => ({
        id: row.id,
        label: `${row.caseNumber} · ${row.title}`,
        mine: mineIds.has(row.id),
      })),
    })
  } catch (cause) {
    return routeError(cause)
  }
}

/** Abmelden: widerruft den Token, mit dem die App gerade anfragt. */
export async function DELETE() {
  const auth = await getCurrentAuth(false)
  if (!auth || auth.kind !== 'api' || !auth.api) return unauthorized()
  await revokeApiToken(auth.api.tokenId, 'In der Desktop-App abgemeldet')
  return success({ ok: true })
}

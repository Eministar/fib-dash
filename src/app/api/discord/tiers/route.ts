import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import {
  conflictingRankAssignments,
  currentManagedRoleIds,
  normalizeDiscordRoleId,
  normalizeRankIds,
  queueSyncAfterTierChange,
  serializeTier,
} from '@/lib/discord-tiers'

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const tiers = await prisma.tier.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { ranks: { select: { rankId: true } } },
    })
    return success(tiers.map(serializeTier))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return error('Name der Ebene ist erforderlich')

    const rankIds = normalizeRankIds(body.rankIds)
    const discordRoleId = normalizeDiscordRoleId(body.discordRoleId)

    const conflicts = await conflictingRankAssignments(rankIds)
    if (conflicts.length > 0) {
      const names = conflicts.map((c) => `${c.rank.name} (bereits in „${c.tier.name}")`).join(', ')
      return error(`Diese Ränge sind bereits einer anderen Ebene zugeordnet: ${names}`)
    }

    const previousManaged = await currentManagedRoleIds()

    const last = await prisma.tier.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const tier = await prisma.tier.create({
      data: {
        name,
        discordRoleId,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        ranks: { create: rankIds.map((rankId) => ({ rankId })) },
      },
      include: { ranks: { select: { rankId: true } } },
    })

    await queueSyncAfterTierChange(previousManaged)

    return success(serializeTier(tier))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (msg.includes('Unique constraint')) return error('Eine Ebene mit diesem Namen existiert bereits')
    return error(msg, 500)
  }
}

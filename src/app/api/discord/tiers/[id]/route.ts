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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.tier.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return error('Ebene nicht gefunden', 404)

    const name = body.name === undefined ? undefined : String(body.name).trim()
    if (name !== undefined && !name) return error('Name der Ebene ist erforderlich')

    const discordRoleId = body.discordRoleId === undefined ? undefined : normalizeDiscordRoleId(body.discordRoleId)
    const rankIds = body.rankIds === undefined ? undefined : normalizeRankIds(body.rankIds)

    if (rankIds !== undefined) {
      const conflicts = await conflictingRankAssignments(rankIds, id)
      if (conflicts.length > 0) {
        const names = conflicts.map((c) => `${c.rank.name} (bereits in „${c.tier.name}")`).join(', ')
        return error(`Diese Ränge sind bereits einer anderen Ebene zugeordnet: ${names}`)
      }
    }

    const previousManaged = await currentManagedRoleIds()

    await prisma.$transaction(async (tx) => {
      await tx.tier.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(discordRoleId !== undefined ? { discordRoleId } : {}),
        },
      })
      if (rankIds !== undefined) {
        await tx.tierRank.deleteMany({ where: { tierId: id } })
        if (rankIds.length > 0) {
          await tx.tierRank.createMany({ data: rankIds.map((rankId) => ({ tierId: id, rankId })) })
        }
      }
    })

    const tier = await prisma.tier.findUniqueOrThrow({
      where: { id },
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const { id } = await params

    const existing = await prisma.tier.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return error('Ebene nicht gefunden', 404)

    const previousManaged = await currentManagedRoleIds()

    // TierRank hängt per onDelete: Cascade — die Ebene löschen genügt.
    await prisma.tier.delete({ where: { id } })

    await queueSyncAfterTierChange(previousManaged)

    return success({ message: 'Ebene gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

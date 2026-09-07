import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const { id } = await params
    const body = await req.json()

    const bMin = body.badgeMin === undefined
      ? undefined
      : body.badgeMin === null || body.badgeMin === ''
        ? null
        : parseInt(String(body.badgeMin), 10)
    const bMax = body.badgeMax === undefined
      ? undefined
      : body.badgeMax === null || body.badgeMax === ''
        ? null
        : parseInt(String(body.badgeMax), 10)
    if (bMin != null && bMax != null && bMin > bMax) {
      return error('Dienstnummer-Minimum darf nicht größer als Maximum sein')
    }
    const internalNumber = body.internalNumber === undefined
      ? undefined
      : body.internalNumber === null || body.internalNumber === ''
        ? null
        : Number(body.internalNumber)
    if (internalNumber != null && (!Number.isSafeInteger(internalNumber) || internalNumber < 1)) {
      return error('Die interne Rangnummer muss eine positive ganze Zahl sein')
    }
    if (internalNumber != null) {
      const duplicate = await prisma.rank.findFirst({
        where: { internalNumber, id: { not: id } },
        select: { name: true },
      })
      if (duplicate) return error(`Interne Rangnummer ${internalNumber} wird bereits von „${duplicate.name}“ verwendet`)
    }

    const rank = await prisma.rank.update({
      where: { id },
      data: {
        name: body.name,
        sortOrder: body.sortOrder,
        internalNumber,
        color: body.color,
        badgeMin: bMin,
        badgeMax: bMax,
      },
    })

    return success(rank)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Name oder interne Rangnummer ist bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const { id } = await params

    // Nur aktive (nicht gekündigte) Agents blockieren das Löschen — mit Namen in der Meldung
    const activeHolders = await prisma.agent.findMany({
      where: { rankId: id, status: { not: 'TERMINATED' } },
      select: { firstName: true, lastName: true },
    })
    if (activeHolders.length > 0) {
      const names = activeHolders.slice(0, 5).map((o) => `${o.firstName} ${o.lastName}`).join(', ')
      const more = activeHolders.length > 5 ? `, +${activeHolders.length - 5} weitere` : ''
      return error(`Rang wird noch von ${activeHolders.length} Agent(n) verwendet: ${names}${more}`)
    }

    // Gekündigte Agents referenzieren den Rang ggf. noch → auf den niedrigsten
    // verbleibenden Rang umhängen (ihr Rang bei Kündigung bleibt im Kündigungseintrag erhalten)
    const terminatedCount = await prisma.agent.count({ where: { rankId: id } })
    let fallbackRank: { id: string } | null = null
    if (terminatedCount > 0) {
      fallbackRank = await prisma.rank.findFirst({
        where: { id: { not: id } },
        orderBy: { sortOrder: 'desc' },
        select: { id: true },
      })
      if (!fallbackRank) {
        return error('Rang kann nicht gelöscht werden: gekündigte Agents referenzieren ihn und es existiert kein anderer Rang')
      }
    }

    // Historie-Einträge referenzieren Ränge ohne Cascade — vor dem Löschen entfernen
    await prisma.$transaction([
      ...(fallbackRank
        ? [prisma.agent.updateMany({ where: { rankId: id }, data: { rankId: fallbackRank.id } })]
        : []),
      prisma.promotionLog.deleteMany({ where: { OR: [{ oldRankId: id }, { newRankId: id }] } }),
      prisma.rankChangeListEntry.deleteMany({ where: { OR: [{ currentRankId: id }, { proposedRankId: id }] } }),
      prisma.rank.delete({ where: { id } }),
    ])
    return success({ message: 'Rang gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }
}

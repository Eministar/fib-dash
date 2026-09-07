import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'
import { resolveEntryBadgeNumbers } from '@/lib/badge-number'
import { findBadgeNumberConflict, getBlacklistedBadgeRows, releaseTerminatedBadgeNumberConflicts } from '@/lib/badge-blacklist'
import { queueDiscordHrEvent, queueAgentRoleSync } from '@/lib/discord-integration'
import { undoPromotionListEntry } from '@/lib/rank-change-list-undo'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-change-lists:execute'])
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const entryId = typeof body.entryId === 'string' ? body.entryId : null
    const action = typeof body.action === 'string' ? body.action : null

    if (action === 'undo') {
      if (!entryId) return error('Entry ID ist erforderlich')
      const result = await undoPromotionListEntry(id, entryId, user)
      if (!result.ok) return error(result.message, result.status)
      return success(result.data)
    }

    const list = await prisma.rankChangeList.findUnique({
      where: { id },
      include: {
        entries: {
          where: { executed: false },
          orderBy: { createdAt: 'asc' },
          include: {
            agent: true,
            currentRank: true,
            proposedRank: true,
            createdBy: { select: { id: true, displayName: true, discordId: true } },
          },
        },
      },
    })

    if (!list) return error('Liste nicht gefunden', 404)
    const targetEntries = entryId ? list.entries.filter((entry) => entry.id === entryId) : list.entries
    if (targetEntries.length === 0) {
      return error(entryId ? 'Eintrag nicht gefunden oder bereits durchgeführt' : 'Keine offenen Einträge vorhanden')
    }

    const prefix = await getBadgePrefix()
    const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
    // Exclude terminated agents so their badge numbers are considered free
    const allRows = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
    const blacklistedBadges = await getBlacklistedBadgeRows()
    // Auto-DNs werden erst hier aus dem aktuellen Stand vergeben; alle offenen Einträge der
    // Liste fließen ein, damit auch bei Einzel-Durchführung keine Nummer doppelt vergeben wird.
    // null bedeutet: Agent behält seine aktuelle Dienstnummer (z. B. Bereich voll).
    const resolvedBadges = resolveEntryBadgeNumbers(list.entries, allRows, blacklistedBadges, prefix)
    const requestedBadges = new Map<string, string>()
    for (const entry of targetEntries) {
      const nextBadge = resolvedBadges.get(entry.id) ?? null
      if (!nextBadge || nextBadge === entry.agent.badgeNumber) continue
      const badgeConflict = await findBadgeNumberConflict(nextBadge, prefix, entry.agentId, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
      if (badgeConflict) return error(`${badgeConflict}: ${nextBadge}`)
      if (!allowDuplicateBadgeNumbers) {
        const duplicateEntry = requestedBadges.get(nextBadge)
        if (duplicateEntry) {
          return error(`Dienstnummer ${nextBadge} ist mehrfach in dieser Liste vorgesehen`)
        }
      }
      requestedBadges.set(nextBadge, entry.agentId)

      const owner = await prisma.agent.findFirst({ where: { badgeNumber: nextBadge }, select: { id: true, status: true } })
      // If owner exists and is not terminated and not the same agent, it's a conflict.
      if (!allowDuplicateBadgeNumbers && owner && owner.id !== entry.agentId && owner.status !== 'TERMINATED') return error(`Dienstnummer ${nextBadge} ist bereits vergeben`)
      await releaseTerminatedBadgeNumberConflicts(nextBadge, prefix)
      entry.newBadgeNumber = nextBadge
    }

    let executed = 0
    let skippedBlocked = 0

    for (const entry of targetEntries) {
      if (entry.agent.status === 'TERMINATED') continue

      // Uprank-Sperre: gesperrte Agent bei Beförderungen (Aufstieg = kleinerer
      // sortOrder) überspringen. Degradierungen bleiben erlaubt.
      if (entry.proposedRank.sortOrder < entry.currentRank.sortOrder && entry.agent.promotionBlocked) {
        skippedBlocked++
        continue
      }

      await prisma.promotionLog.create({
        data: {
          agentId: entry.agentId,
          oldRankId: entry.currentRankId,
          newRankId: entry.proposedRankId,
          oldBadgeNumber: entry.agent.badgeNumber,
          newBadgeNumber: entry.newBadgeNumber || entry.agent.badgeNumber,
          performedByUserId: user.id,
          note: entry.note ? `[${list.name}] ${entry.note}` : `[${list.name}]`,
        },
      })

      const updatedAgent = await prisma.agent.update({
        where: { id: entry.agentId },
        data: {
          rankId: entry.proposedRankId,
          badgeNumber: entry.newBadgeNumber || entry.agent.badgeNumber,
        },
      })
      await syncLinkedUserDisplayNameForAgent(updatedAgent)

      await prisma.rankChangeListEntry.update({
        where: { id: entry.id },
        data: { executed: true, executedAt: new Date(), executedById: user.id },
      })

      // Richtung pro Eintrag: kleinerer sortOrder = höherer Rang = Beförderung.
      const action = entry.proposedRank.sortOrder > entry.currentRank.sortOrder ? 'Degradierung' : 'Beförderung'
      await createAuditLog({
        action: 'AGENT_PROMOTED',
        userId: user.id,
        agentId: entry.agentId,
        oldValue: entry.currentRank.name,
        newValue: entry.proposedRank.name,
        details: `${action} via "${list.name}": ${entry.agent.firstName} ${entry.agent.lastName} – ${entry.currentRank.name} → ${entry.proposedRank.name}`,
      })

      queueAgentRoleSync(entry.agentId)
      const submittedBy = entry.createdBy ?? null
      const fields: { name: string; value: string; inline?: boolean }[] = [
        { name: 'Alter Rang', value: entry.currentRank.name, inline: true },
        { name: 'Neuer Rang', value: `**${entry.proposedRank.name}**`, inline: true },
        { name: 'DN-Wechsel', value: `${entry.agent.badgeNumber} → **${entry.newBadgeNumber || entry.agent.badgeNumber}**`, inline: true },
      ]
      if (submittedBy) {
        fields.push({
          name: 'Eingereicht von',
          value: submittedBy.discordId ? `<@${submittedBy.discordId}>` : submittedBy.displayName,
          inline: true,
        })
      }
      queueDiscordHrEvent({
        type: 'promotion',
        title: `${action}: ${entry.agent.firstName} ${entry.agent.lastName}`,
        description: entry.note
          ? `Die ${action.toLocaleLowerCase('de-DE')} wurde im Rahmen der Liste **${list.name}** vorgenommen.\n\n**Anmerkung:** ${entry.note}`
          : `Die ${action.toLocaleLowerCase('de-DE')} wurde im Rahmen der Liste **${list.name}** vorgenommen.`,
        agent: {
          ...entry.agent,
          badgeNumber: entry.newBadgeNumber || entry.agent.badgeNumber,
          rank: entry.proposedRank,
        },
        actor: user,
        fields,
      })

      executed++
    }

    // Immer real zählen: übersprungene (gesperrte) Einträge bleiben offen, damit die
    // Liste nicht fälschlich als abgeschlossen markiert wird.
    const remainingEntries = await prisma.rankChangeListEntry.count({ where: { listId: id, executed: false } })

    if (remainingEntries === 0) {
      await prisma.rankChangeList.update({
        where: { id },
        data: { status: 'COMPLETED' },
      })
    }

    return success({ executed, total: targetEntries.length, skippedBlocked })
  } catch (e: unknown) {
    // Log error for debugging (will appear in server console)
    console.error('Error executing rank-change-list:', e)
    if (isUniqueConstraintError(e)) return error('Discord-ID bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    // If the error is a plain Bad Request string from Next or middleware, return it as 400
    return error(msg, 400)
  }
}

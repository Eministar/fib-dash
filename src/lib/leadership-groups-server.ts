import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from './prisma'
import { getConfidentialUser } from './auth'
import { getDiscordConfig } from './discord-integration'
import { canManageLeadershipGroups, leadershipGroupVisibility, privateChannelOverwrites, type LeadershipGroupInput } from './leadership-groups'

class GroupError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export function groupResponse(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

// Do not forward confidential failures to the public Discord error webhook.
export function groupError(error: unknown) {
  const message = error instanceof GroupError ? error.message
    : error instanceof z.ZodError ? error.issues[0]?.message
    : 'Ermittlungsgruppen konnten nicht verarbeitet werden. Bitte erneut versuchen.'
  return NextResponse.json({ success: false, error: message }, {
    status: error instanceof GroupError ? error.status : error instanceof z.ZodError ? 400 : 500,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function groupUser(manage = false) {
  const user = await getConfidentialUser()
  if (!user) throw new GroupError('Nicht angemeldet.', 401)
  if (manage && !canManageLeadershipGroups(user)) throw new GroupError('Keine Berechtigung.', 403)
  return user
}

export async function listGroups(user: Awaited<ReturnType<typeof groupUser>>) {
  const groups = await prisma.leadershipGroup.findMany({
    where: leadershipGroupVisibility(user), include: { members: true }, orderBy: { name: 'asc' },
  })
  const users = await prisma.user.findMany({
    where: { id: { in: groups.flatMap(g => g.members.map(m => m.userId)) } },
    select: { id: true, displayName: true },
  })
  const families = groups.flatMap(g => g.families as LeadershipGroupInput['families'])
  const dossiers = await prisma.dossier.findMany({
    where: { id: { in: families.map(f => f.dossierId) } }, select: { id: true, title: true },
  })
  return groups.map(g => ({
    id: g.id, name: g.name, version: g.version, syncPending: g.syncPending,
    discordUrl: g.channelId && g.guildId ? `https://discord.com/channels/${g.guildId}/${g.channelId}` : null,
    members: g.members.map(m => ({ id: m.userId, displayName: users.find(u => u.id === m.userId)?.displayName ?? 'Gelöschtes Konto' })),
    families: (g.families as LeadershipGroupInput['families']).map(f => ({ ...f, title: dossiers.find(d => d.id === f.dossierId)?.title ?? 'Gelöschte Familienakte' })),
  }))
}

export async function saveGroup(id: string | undefined, input: LeadershipGroupInput, actor: Awaited<ReturnType<typeof groupUser>>) {
  // Check independently of the route, so future callers cannot bypass authorization.
  if (!canManageLeadershipGroups(actor)) throw new GroupError('Keine Berechtigung.', 403)
  const members = await prisma.user.findMany({ where: { id: { in: input.memberIds } }, select: { id: true, discordId: true, displayName: true } })
  if (members.length !== input.memberIds.length || members.some(m => !m.discordId || !/^\d{17,22}$/.test(m.discordId)))
    throw new GroupError('Alle Mitglieder benötigen ein verknüpftes Discord-Konto.')
  if (new Set(members.map(m => m.discordId)).size !== members.length)
    throw new GroupError('Ein Discord-Konto darf nur einmal in einer Gruppe vorkommen.')
  const families = await prisma.dossier.count({ where: { id: { in: input.families.map(f => f.dossierId) }, kind: 'FAMILY' } })
  if (families !== input.families.length) throw new GroupError('Bitte gültige Familienakten auswählen.')

  const group = await prisma.$transaction(async tx => {
    const old = id ? await tx.leadershipGroup.findUnique({ where: { id }, include: { members: true } }) : null
    if (id && !old) throw new GroupError('Gruppe nicht gefunden.', 404)
    if (old && (old.version !== input.version || (old.syncLeaseUntil && old.syncLeaseUntil > new Date())))
      throw new GroupError('Gruppe wurde geändert oder wird synchronisiert. Bitte neu laden.', 409)
    const oldIds = old?.members.map(m => m.userId) ?? []
    const removed = await tx.user.findMany({ where: { id: { in: oldIds.filter(id => !input.memberIds.includes(id)) } }, select: { displayName: true } })
    const events = [
      ...(!old ? [`${actor.displayName} hat die Gruppe „${input.name}“ erstellt.`] : old.name !== input.name ? [`${actor.displayName} hat die Gruppe in „${input.name}“ umbenannt.`] : []),
      ...members.filter(m => !oldIds.includes(m.id)).map(m => `${actor.displayName} hat ${m.displayName} zur Gruppe hinzugefügt.`),
      ...removed.map(m => `${actor.displayName} hat ${m.displayName} aus der Gruppe entfernt.`),
      ...(old && JSON.stringify(old.families) !== JSON.stringify(input.families) ? [`${actor.displayName} hat die Familienzuordnungen und Leitungen aktualisiert.`] : []),
    ]
    if (old) {
      const changed = await tx.leadershipGroup.updateMany({
        where: { id: old.id, version: input.version, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] },
        data: { name: input.name, families: input.families, version: { increment: 1 }, syncPending: true, nextSyncAt: new Date() },
      })
      if (!changed.count) throw new GroupError('Gruppe wurde zwischenzeitlich geändert. Bitte neu laden.', 409)
      await tx.leadershipGroupMember.deleteMany({ where: { groupId: old.id } })
      await tx.leadershipGroupMember.createMany({ data: input.memberIds.map(userId => ({ groupId: old.id, userId })) })
      await tx.leadershipGroupEvent.createMany({ data: events.map(text => ({ groupId: old.id, text })) })
      return { id: old.id }
    }
    return tx.leadershipGroup.create({ data: {
      name: input.name, families: input.families,
      members: { create: input.memberIds.map(userId => ({ userId })) },
      events: { create: events.map(text => ({ text })) },
    } })
  })
  return { id: group.id, synced: await syncGroup(group.id).catch(() => false) }
}

// Dedicated transport intentionally never logs request paths, bodies or identities.
async function discord<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() || process.env.FIB_DISCORD_BOT_TOKEN?.trim()
  if (!token) throw new GroupError('Discord Bot-Token fehlt.')
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method, headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000), cache: 'no-store',
  })
  if (!response.ok) throw new GroupError('Discord-Synchronisierung ausstehend. Bot-Konfiguration und Kanalrechte prüfen.')
  return response.status === 204 ? undefined as T : response.json()
}

export async function syncGroup(id: string) {
  const lease = new Date(Date.now() + 300_000)
  const claimed = await prisma.leadershipGroup.updateMany({
    where: { id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] },
    data: { syncLeaseUntil: lease, nextSyncAt: new Date(Date.now() + 60_000) },
  })
  if (!claimed.count) return false
  const send = <T>(path: string, method = 'GET', body?: unknown) => {
    // Never begin an external write near lease expiry: an old worker must not
    // restore a removed member after another worker has acquired the group.
    if (Date.now() + 15_000 >= lease.getTime()) throw new GroupError('Synchronisierung wird erneut versucht.')
    return discord<T>(path, method, body)
  }
  try {
    const group = await prisma.leadershipGroup.findUniqueOrThrow({ where: { id }, include: { members: true } })
    const config = await getDiscordConfig()
    const guildId = group.guildId || config.guildId
    if (!guildId) throw new GroupError('Discord-Server fehlt.')
    const bot = await send<{ id: string }>('/users/@me')
    const members = await prisma.user.findMany({ where: { id: { in: group.members.map(m => m.userId) } }, select: { discordId: true } })
    const body = {
      name: `eg-${group.name}`.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '-').slice(0, 100),
      type: 0,
      permission_overwrites: privateChannelOverwrites(guildId, bot.id, members.flatMap(m => m.discordId ? [m.discordId] : [])),
    }
    let channelId = group.channelId
    if (!channelId) {
      // A private marker lets retries recover a channel after a lost create response.
      const marker = `fib-leadership:${id}`
      const channels = await send<{ id: string; topic?: string }[]>(`/guilds/${guildId}/channels`)
      channelId = channels.find(c => c.topic === marker)?.id ?? null
      if (!channelId) channelId = (await send<{ id: string }>(`/guilds/${guildId}/channels`, 'POST', { ...body, topic: marker })).id
      await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { channelId, guildId } })
    }
    // Replaces the entire overwrite list, removing old member and role grants.
    await send(`/channels/${channelId}`, 'PATCH', body)
    const events = await prisma.leadershipGroupEvent.findMany({ where: { groupId: id, sentAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5 })
    for (const event of events) {
      await send(`/channels/${channelId}/messages`, 'POST', {
        content: event.text.slice(0, 2000), allowed_mentions: { parse: [] }, nonce: event.id, enforce_nonce: true,
      })
      await prisma.leadershipGroupEvent.update({ where: { id: event.id }, data: { sentAt: new Date() } })
    }
    const remaining = await prisma.leadershipGroupEvent.count({ where: { groupId: id, sentAt: null } })
    await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { syncPending: remaining > 0, nextSyncAt: new Date(Date.now() + (remaining > 0 ? 30_000 : 300_000)) } })
    return remaining === 0
  } catch {
    await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { syncPending: true } })
    return false
  } finally {
    await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { syncLeaseUntil: null } })
  }
}

const runtime = globalThis as typeof globalThis & { leadershipGroupTimer?: ReturnType<typeof setInterval> }

export function ensureLeadershipGroupSync() {
  if (runtime.leadershipGroupTimer) return
  let running = false
  runtime.leadershipGroupTimer = setInterval(async () => {
    if (running) return
    running = true
    try {
      const due = await prisma.leadershipGroup.findMany({
        where: { nextSyncAt: { lte: new Date() }, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] },
        select: { id: true }, orderBy: { nextSyncAt: 'asc' }, take: 2,
      })
      for (const group of due) await syncGroup(group.id)
    } catch { /* No sensitive details in general logs; setup may not have applied the schema yet. */ }
    finally { running = false }
  }, 30_000)
  runtime.leadershipGroupTimer.unref()
}

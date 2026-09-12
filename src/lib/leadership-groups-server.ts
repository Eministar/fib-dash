import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from './prisma'
import { getConfidentialUser } from './auth'
import { getDiscordConfig } from './discord-integration'
import { canManageLeadershipGroups, leadershipGroupVisibility, privateChannelOverwrites, groupEventEmbed, type LeadershipGroupFamily, type LeadershipGroupInput } from './leadership-groups'

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
  return groups.map(g => ({
    id: g.id, name: g.name, version: g.version, syncPending: g.syncPending,
    channelId: g.channelManaged ? '' : g.channelId ?? '',
    discordUrl: g.channelId && g.guildId ? `https://discord.com/channels/${g.guildId}/${g.channelId}` : null,
    members: g.members.map(m => ({ id: m.userId, displayName: users.find(u => u.id === m.userId)?.displayName ?? 'Gelöschtes Konto' })),
    families: g.families as LeadershipGroupFamily[],
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
  const adopted = input.channelId?.trim() || null
  if (adopted) {
    const taken = await prisma.leadershipGroup.findFirst({ where: { channelId: adopted, ...(id ? { NOT: { id } } : {}) }, select: { id: true } })
    if (taken) throw new GroupError('Dieser Discord-Kanal wird bereits von einer anderen Ermittlungsgruppe genutzt.')
  }

  const group = await prisma.$transaction(async tx => {
    const old = id ? await tx.leadershipGroup.findUnique({ where: { id }, include: { members: true } }) : null
    if (id && !old) throw new GroupError('Gruppe nicht gefunden.', 404)
    if (old && (old.version !== input.version || (old.syncLeaseUntil && old.syncLeaseUntil > new Date())))
      throw new GroupError('Gruppe wurde geändert oder wird synchronisiert. Bitte neu laden.', 409)
    const oldIds = old?.members.map(m => m.userId) ?? []
    const removed = await tx.user.findMany({ where: { id: { in: oldIds.filter(memberId => !input.memberIds.includes(memberId)) } }, select: { displayName: true } })
    // An adopted channel replaces the current one; clearing the field creates an own private channel again.
    const channel = adopted
      ? { channelId: adopted, channelManaged: false, ...(old?.channelId === adopted ? {} : { guildId: null }) }
      : old?.channelManaged === false ? { channelId: null, channelManaged: true, guildId: null } : {}
    const events: { kind: string; text: string }[] = [
      ...(!old ? [{ kind: 'created', text: `${actor.displayName} hat die Gruppe „${input.name}“ erstellt.` }]
        : old.name !== input.name ? [{ kind: 'renamed', text: `${actor.displayName} hat die Gruppe „${old.name}“ in „${input.name}“ umbenannt.` }] : []),
      ...members.filter(m => !oldIds.includes(m.id)).map(m => ({ kind: 'added', text: `${actor.displayName} hat ${m.displayName} zur Gruppe hinzugefügt.` })),
      ...removed.map(m => ({ kind: 'removed', text: `${actor.displayName} hat ${m.displayName} aus der Gruppe entfernt.` })),
      ...(old && JSON.stringify(old.families) !== JSON.stringify(input.families)
        ? [{ kind: 'families', text: `${actor.displayName} hat die Familienzuordnungen und Leitungen aktualisiert.` }] : []),
    ]
    if (old) {
      const changed = await tx.leadershipGroup.updateMany({
        where: { id: old.id, version: input.version, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] },
        data: { name: input.name, families: input.families, ...channel, version: { increment: 1 }, syncPending: true, nextSyncAt: new Date() },
      })
      if (!changed.count) throw new GroupError('Gruppe wurde zwischenzeitlich geändert. Bitte neu laden.', 409)
      await tx.leadershipGroupMember.deleteMany({ where: { groupId: old.id } })
      await tx.leadershipGroupMember.createMany({ data: input.memberIds.map(userId => ({ groupId: old.id, userId })) })
      await tx.leadershipGroupEvent.createMany({ data: events.map(event => ({ ...event, groupId: old.id })) })
      return { id: old.id }
    }
    return tx.leadershipGroup.create({ data: {
      name: input.name, families: input.families,
      ...(adopted ? { channelId: adopted, channelManaged: false } : {}),
      members: { create: input.memberIds.map(userId => ({ userId })) },
      events: { create: events },
    } })
  })
  return { id: group.id, synced: await syncGroup(group.id).catch(() => false) }
}

export async function deleteGroup(id: string, actor: Awaited<ReturnType<typeof groupUser>>) {
  if (!canManageLeadershipGroups(actor)) throw new GroupError('Keine Berechtigung.', 403)
  // The lease keeps the sync worker out while the channel is being cleaned up.
  const lease = new Date(Date.now() + 300_000)
  const claimed = await prisma.leadershipGroup.updateMany({
    where: { id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lte: new Date() } }] },
    data: { syncLeaseUntil: lease },
  })
  if (!claimed.count) throw new GroupError('Gruppe wird gerade synchronisiert. Bitte kurz warten und erneut versuchen.', 409)
  const group = await prisma.leadershipGroup.findUnique({ where: { id } })
  if (!group) throw new GroupError('Gruppe nicht gefunden.', 404)
  let discordCleaned = true
  try {
    if (group.channelId) {
      const bot = await discord<{ id: string }>('/users/@me')
      await discord(`/channels/${group.channelId}/messages`, 'POST', {
        embeds: [groupEventEmbed({ kind: 'deleted', text: `${actor.displayName} hat die Gruppe aufgelöst.`, createdAt: new Date() }, group.name)],
        allowed_mentions: { parse: [] },
      })
      if (group.channelManaged) await discord(`/channels/${group.channelId}`, 'DELETE')
      // An adopted channel stays, but every member grant this module set is withdrawn.
      else if (group.guildId) await discord(`/channels/${group.channelId}`, 'PATCH', { permission_overwrites: privateChannelOverwrites(group.guildId, bot.id, []) })
    }
  } catch { discordCleaned = false }
  // Dashboard access ends regardless of Discord: confidentiality comes first.
  await prisma.leadershipGroup.delete({ where: { id } })
  return { discordCleaned, channelKept: !!group.channelId && !group.channelManaged }
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
    const bot = await send<{ id: string }>('/users/@me')
    let channelId = group.channelId
    let guildId = group.guildId
    // An adopted channel supplies its own guild; the bot must be able to read it.
    if (channelId && !guildId) {
      const channel = await send<{ guild_id?: string; type: number }>(`/channels/${channelId}`)
      if (!channel.guild_id || channel.type !== 0) throw new GroupError('Der angegebene Kanal ist kein Textkanal dieses Servers.')
      guildId = channel.guild_id
      await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { guildId } })
    }
    guildId = guildId || (await getDiscordConfig()).guildId
    if (!guildId) throw new GroupError('Discord-Server fehlt.')
    const members = await prisma.user.findMany({ where: { id: { in: group.members.map(m => m.userId) } }, select: { discordId: true } })
    const overwrites = privateChannelOverwrites(guildId, bot.id, members.flatMap(m => m.discordId ? [m.discordId] : []))
    if (!channelId) {
      // A private marker lets retries recover a channel after a lost create response.
      const marker = `fib-leadership:${id}`
      const channels = await send<{ id: string; topic?: string }[]>(`/guilds/${guildId}/channels`)
      channelId = channels.find(c => c.topic === marker)?.id ?? null
      if (!channelId) channelId = (await send<{ id: string }>(`/guilds/${guildId}/channels`, 'POST', {
        name: `eg-${group.name}`.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '-').slice(0, 100),
        type: 0, topic: marker, permission_overwrites: overwrites,
      })).id
      await prisma.leadershipGroup.updateMany({ where: { id, syncLeaseUntil: lease }, data: { channelId, guildId } })
    }
    // Replaces the entire overwrite list, removing old member and role grants.
    // An adopted channel keeps its own name and topic; only its access list is enforced.
    await send(`/channels/${channelId}`, 'PATCH', { permission_overwrites: overwrites })
    const events = await prisma.leadershipGroupEvent.findMany({ where: { groupId: id, sentAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5 })
    for (const event of events) {
      await send(`/channels/${channelId}/messages`, 'POST', {
        embeds: [groupEventEmbed(event, group.name)], allowed_mentions: { parse: [] }, nonce: event.id, enforce_nonce: true,
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

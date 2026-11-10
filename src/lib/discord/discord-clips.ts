type Overwrite = { id: string; type: number; allow: string; deny: string }
type Channel = { id: string; type: number; name: string; topic?: string; parent_id?: string | null; position?: number; permission_overwrites?: Overwrite[] }
type Request = <T>(path: string, init?: RequestInit) => Promise<T>
type Agent = { id: string; lastName: string; discordId: string | null; status: string }

const VIEW = BigInt(1024)
const ACCESS = (VIEW | BigInt(2048) | BigInt(16384) | BigInt(32768) | BigInt(65536)).toString()
/** Mitarbeiter dürfen alle Clips-Channels sehen und den Verlauf lesen, aber nicht schreiben. */
const READ = (VIEW | BigInt(65536)).toString()
let pending: Promise<unknown> = Promise.resolve()

/** Serialize provisioning so overlapping single/full syncs cannot create duplicates. */
export function syncAgentClipChannel(request: Request, guildId: string, analystRoleId: string, agent: Agent, remove = false, categoryId = '', employeeRoleIds: string[] = []) {
  const result = pending.catch(() => undefined).then(() => reconcile(request, guildId, analystRoleId, agent, remove, categoryId, employeeRoleIds))
  pending = result
  return result
}

const CLIP_TOPIC_PREFIX = 'fib-agent-clips:'

/**
 * Neue Positionen, damit die Clips-Channels einer Kategorie in derselben
 * Reihenfolge stehen wie die Mitarbeiterliste. Leer, wenn alles schon passt.
 * Andere Channels der Kategorie werden nicht angefasst; die Clips-Channels
 * tauschen nur untereinander ihre bisherigen Plätze.
 */
export function clipChannelPositions(channels: Channel[], categoryId: string, orderedAgentIds: string[]) {
  const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0) || a.id.length - b.id.length || a.id.localeCompare(b.id)
  const current = channels
    .filter(channel => channel.type === 0 && channel.parent_id === categoryId && channel.topic?.startsWith(CLIP_TOPIC_PREFIX))
    .sort(byPosition)
  const rosterIndex = new Map(orderedAgentIds.map((id, index) => [id, index]))
  const rank = (channel: Channel) => rosterIndex.get(channel.topic!.slice(CLIP_TOPIC_PREFIX.length)) ?? Number.MAX_SAFE_INTEGER
  const desired = current
    .map((channel, index) => ({ channel, index }))
    .sort((a, b) => rank(a.channel) - rank(b.channel) || a.index - b.index)
    .map(({ channel }) => channel)
  if (desired.every((channel, index) => channel.id === current[index].id)) return []

  // Bisherige Plätze wiederverwenden, aber streng aufsteigend machen.
  const slots: number[] = []
  for (const channel of current) slots.push(Math.max(channel.position ?? 0, (slots.at(-1) ?? -1) + 1))
  return desired
    .map((channel, index) => ({ id: channel.id, position: slots[index] }))
    .filter(({ id, position }) => channels.find(channel => channel.id === id)?.position !== position)
}

/** Sortiert die Clips-Channels nach der Mitarbeiterliste; läuft in derselben Warteschlange wie der Sync. */
export function orderAgentClipChannels(request: Request, guildId: string, categoryId: string, orderedAgentIds: string[]) {
  const result = pending.catch(() => undefined).then(async () => {
    if (!categoryId) return
    const channels = await request<Channel[]>(`/guilds/${guildId}/channels`)
    const positions = clipChannelPositions(channels, categoryId, orderedAgentIds)
    if (positions.length) await request(`/guilds/${guildId}/channels`, { method: 'PATCH', body: JSON.stringify(positions) })
  })
  pending = result
  return result
}

/**
 * Einmal-Migration für bestehende Clips-Channels: ergänzt fehlende Leserechte der
 * Mitarbeiter-Rollen, ohne andere Rechte anzufassen. Idempotent – Channels, die
 * schon passen, werden nicht geschrieben. Gibt die Zahl der geänderten Channels zurück.
 */
export function grantEmployeeClipAccess(request: Request, guildId: string, analystRoleId: string, employeeRoleIds: string[]) {
  const result = pending.catch(() => undefined).then(async () => {
    if (!guildId || !employeeRoleIds.length) return 0
    const roles = await request<{ id: string }[]>(`/guilds/${guildId}/roles`)
    const roleIds = new Set(roles.map(role => role.id))
    const employees = [...new Set(employeeRoleIds)].filter(id => id !== guildId && id !== analystRoleId && roleIds.has(id))
    if (!employees.length) return 0
    const channels = await request<Channel[]>(`/guilds/${guildId}/channels`)
    let changed = 0
    for (const channel of channels.filter(channel => channel.type === 0 && channel.topic?.startsWith(CLIP_TOPIC_PREFIX))) {
      const current = channel.permission_overwrites ?? []
      const missing = employees.filter(id => !current.some(item => item.id === id && item.allow === READ && item.deny === '0'))
      if (!missing.length) continue
      const permission_overwrites = [
        ...current.filter(item => !missing.includes(item.id)),
        ...missing.map(id => ({ id, type: 0, allow: READ, deny: '0' })),
      ]
      await request(`/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ permission_overwrites }) })
      changed++
    }
    return changed
  })
  pending = result
  return result
}

async function reconcile(request: Request, guildId: string, analystRoleId: string, agent: Agent, remove: boolean, categoryId: string, employeeRoleIds: string[]) {
  const topic = `fib-agent-clips:${agent.id}`
  // Termination cleanup must also work if the role/category was removed meanwhile.
  if (agent.status === 'TERMINATED') {
    const channels = await request<Channel[]>(`/guilds/${guildId}/channels`)
    for (const channel of channels.filter(channel => channel.type === 0 && channel.topic === topic)) {
      await request(`/channels/${channel.id}`, { method: 'DELETE' })
    }
    return
  }
  if (!analystRoleId) return
  if (analystRoleId === guildId) throw new Error('Die Analysten-Rolle darf nicht @everyone sein.')
  const roles = await request<{ id: string }[]>(`/guilds/${guildId}/roles`)
  if (!roles.some(role => role.id === analystRoleId)) throw new Error('Die konfigurierte Clips-Analysten-Rolle existiert nicht.')
  const channels = await request<Channel[]>(`/guilds/${guildId}/channels`)
  const existing = channels.filter(channel => channel.type === 0 && channel.topic === topic)
  const active = !remove && agent.status !== 'TERMINATED' && !!agent.discordId
  if (!active && existing.length === 0) return
  const bot = await request<{ id: string }>('/users/@me')
  const base: Overwrite[] = [
    { id: guildId, type: 0, allow: '0', deny: VIEW.toString() },
    { id: analystRoleId, type: 0, allow: ACCESS, deny: '0' },
    { id: bot.id, type: 1, allow: ACCESS, deny: '0' },
  ]
  const roleIds = new Set(roles.map(role => role.id))
  // Nur existierende Rollen, sonst lehnt Discord das ganze Update ab; @everyone und die Analysten-Rolle nicht doppelt.
  const employees = [...new Set(employeeRoleIds)].filter(id => id !== guildId && id !== analystRoleId && roleIds.has(id))
  const overwrites = [...base, ...employees.map(id => ({ id, type: 0, allow: READ, deny: '0' }))]
  if (active && agent.discordId !== bot.id) overwrites.push({ id: agent.discordId!, type: 1, allow: ACCESS, deny: '0' })
  const parent = channels.find(channel => channel.id === categoryId && channel.type === 4)
  if (!parent) throw new Error('Bitte eine gültige Clips-Kategorie in den Einstellungen auswählen.')
  const incoming = existing.length ? existing.filter(channel => channel.parent_id !== parent.id).length : 1
  if (channels.filter(channel => channel.parent_id === parent.id).length + incoming > 50) {
    throw new Error('Die Clips-Kategorie ist voll (maximal 50 Channels). Bitte eine andere Kategorie auswählen.')
  }
  const lastName = agent.lastName.toLowerCase().trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'agent'
  const payload = { name: `🔍│${lastName.slice(0, 85)}-clips`, topic, parent_id: parent.id, permission_overwrites: overwrites }
  if (!existing.length) {
    await request(`/guilds/${guildId}/channels`, { method: 'POST', body: JSON.stringify({ ...payload, type: 0 }) })
  } else {
    // Changing the linked Discord account preserves the channel and its uploads.
    for (const channel of existing) {
      const normalize = (items: Overwrite[]) => JSON.stringify(items.map(item => `${item.type}:${item.id}:${item.allow}:${item.deny}`).sort())
      if (channel.name !== payload.name || channel.parent_id !== parent.id || normalize(channel.permission_overwrites ?? []) !== normalize(overwrites)) {
        await request(`/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      }
    }
  }
}

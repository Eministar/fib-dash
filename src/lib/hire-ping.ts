import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { getDiscordConfig, postHireRolePing, deleteDiscordHrEventMessage } from './discord-integration'
import { withoutChangeTracking } from './change-history-context'

export type HirePingDependencies = {
  claim: (agentId: string) => Promise<boolean>
  post: (channelId: string, roleId: string, nonce: string) => Promise<{ id: string }>
  rememberDelete: (channelId: string, messageId: string) => Promise<void>
  remove: (channelId: string, messageId: string) => Promise<void>
  forgetDelete: (messageId: string) => Promise<void>
  pause: () => Promise<void>
}

export async function performHirePing(agentId: string, channelId: string, roleId: string, deps: HirePingDependencies) {
  if (!/^\d{17,22}$/.test(channelId) || !/^\d{17,22}$/.test(roleId)) return
  if (!await deps.claim(agentId)) return
  const nonce = createHash('sha256').update(`hire:${agentId}`).digest('hex').slice(0, 24)
  const message = await deps.post(channelId, roleId, nonce)
  try { await deps.rememberDelete(channelId, message.id) }
  finally {
    await deps.pause()
    await deps.remove(channelId, message.id)
    await deps.forgetDelete(message.id)
  }
}

const dependencies: HirePingDependencies = {
  claim: async agentId => {
    try { await prisma.systemSetting.create({ data: { key: `discord.hirePing.claim.${agentId}`, value: new Date().toISOString() } }); return true }
    catch (cause) { if ((cause as { code?: string }).code === 'P2002') return false; throw cause }
  },
  post: postHireRolePing,
  rememberDelete: async (channelId, messageId) => { const value = JSON.stringify({ channelId, messageId }); await prisma.systemSetting.upsert({ where: { key: `discord.hirePing.delete.${messageId}` }, create: { key: `discord.hirePing.delete.${messageId}`, value }, update: { value } }) },
  remove: async (channelId, messageId) => {
    if (!process.env.DISCORD_BOT_TOKEN?.trim() && !process.env.FIB_DISCORD_BOT_TOKEN?.trim()) throw new Error('Discord-Bot-Token fehlt; Löschung bleibt vorgemerkt')
    await deleteDiscordHrEventMessage(channelId, messageId)
  },
  forgetDelete: async messageId => { await prisma.systemSetting.deleteMany({ where: { key: `discord.hirePing.delete.${messageId}` } }) },
  pause: () => new Promise(resolve => setTimeout(resolve, 1000)),
}

export function queueHirePing(agentId: string) {
  return withoutChangeTracking(async () => {
    if (process.env.HIRE_PING_ENABLED === 'false') return
    if (!process.env.DISCORD_BOT_TOKEN?.trim() && !process.env.FIB_DISCORD_BOT_TOKEN?.trim()) return
    const config = await getDiscordConfig()
    await performHirePing(agentId, config.hirePingChannelId, config.hirePingRoleId, dependencies)
  })
}

const runtime = globalThis as typeof globalThis & { hirePingCleanupTimer?: ReturnType<typeof setInterval>; hirePingCleanupRunning?: boolean }
export function ensureHirePingCleanup() {
  if (runtime.hirePingCleanupTimer || process.env.HIRE_PING_ENABLED === 'false') return
  const clean = async () => {
    if (runtime.hirePingCleanupRunning) return
    runtime.hirePingCleanupRunning = true
    try {
      const pending = await prisma.systemSetting.findMany({ where: { key: { startsWith: 'discord.hirePing.delete.' } }, take: 100 })
      for (const item of pending) {
        try { const { channelId, messageId } = JSON.parse(item.value); await dependencies.remove(channelId, messageId); await dependencies.forgetDelete(messageId) }
        catch (cause) { console.error('[HirePing] Nachricht konnte noch nicht gelöscht werden:', cause) }
      }
    } finally { runtime.hirePingCleanupRunning = false }
  }
  const run = () => { void withoutChangeTracking(clean).catch(cause => console.error('[HirePing] Cleanup:', cause)) }
  runtime.hirePingCleanupTimer = setInterval(run, 60000)
  runtime.hirePingCleanupTimer.unref?.()
  run()
}

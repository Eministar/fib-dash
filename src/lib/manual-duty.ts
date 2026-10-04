import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import {
  DUTY_ACTIVITY_CHECK_AFTER_MS,
  DUTY_ACTIVITY_RESPONSE_MS,
  DUTY_MODE_SETTING_KEY,
  getDutyMode,
  type DutyMode,
} from '@/lib/duty-mode'
import {
  announceDutyModeChange,
  postDutyAdminLog,
  queueDiscordDutyStatusUpdate,
  resolveDutyActivityCheck,
  sendDutyActivityCheck,
} from '@/lib/discord-integration'
import { formatDuration } from '@/lib/duty-times'
import { runAgentStatusAutomation } from '@/lib/absence-status'

export class DutyClockError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const TICK_MS = 15_000
/** Das Discord-Panel zeigt laufende Dienstzeiten – ohne Ereignis trotzdem regelmäßig auffrischen. */
const PANEL_REFRESH_MS = 60_000
let lastPanelRefresh = 0
let workerStarted = false
let tickRunning = false

function agentName(agent: { firstName: string; lastName: string }) {
  return `${agent.firstName} ${agent.lastName}`.trim()
}

async function requireManualMode() {
  if (await getDutyMode() !== 'manual') {
    throw new DutyClockError('Die Dienstzeit wird automatisch über die API erfasst. Manuelles Stempeln ist nur im manuellen Modus möglich.', 409)
  }
}

/** Konto-Verknüpfung zuerst, ältere Agents sind nur über die Discord-ID verknüpft. */
export async function findAgentForUser(user: { id: string; discordId: string | null }) {
  return prisma.agent.findFirst({
    where: { status: { not: 'TERMINATED' }, OR: [{ userId: user.id }, ...(user.discordId ? [{ discordId: user.discordId }] : [])] },
    orderBy: { userId: 'desc' },
    select: { id: true, firstName: true, lastName: true, discordId: true },
  })
}

export async function findAgentForDiscord(discordId: string) {
  return prisma.agent.findFirst({
    where: { discordId, status: { not: 'TERMINATED' } },
    select: { id: true, firstName: true, lastName: true, discordId: true },
  })
}

export async function getOpenDutySession(agentId: string) {
  return prisma.dutyTimeSession.findFirst({ where: { agentId, clockOutAt: null }, orderBy: { clockInAt: 'desc' } })
}

export async function clockIn(agentId: string, source: 'dashboard' | 'discord', actorDiscordId?: string | null) {
  await requireManualMode()
  const session = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { status: true } })
    if (!agent || agent.status === 'TERMINATED') throw new DutyClockError('Gekündigte Agents können nicht einstempeln.', 403)
    const open = await tx.dutyTimeSession.findFirst({ where: { agentId, clockOutAt: null } })
    if (open) return { session: open, created: false }
    const created = await tx.dutyTimeSession.create({
      data: { agentId, clockInSource: source, actorDiscordId: actorDiscordId ?? null },
    })
    return { session: created, created: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  if (session.created) {
    queueDiscordDutyStatusUpdate()
    // Einstempeln gilt als Aktivität: Inaktiv-Status und gelbe Markierung sofort aufheben.
    void runAgentStatusAutomation({ force: true }).catch((error) => {
      console.error('[ManualDuty] Statusaktualisierung fehlgeschlagen:', error)
    })
  }
  return session
}

async function closeOpenSession(agentId: string, source: 'dashboard' | 'discord' | 'admin', resolvedText: string) {
  await requireManualMode()
  const open = await getOpenDutySession(agentId)
  if (!open) return null
  const now = new Date()
  const { count } = await prisma.dutyTimeSession.updateMany({
    where: { id: open.id, clockOutAt: null },
    data: { clockOutAt: now, clockOutSource: source },
  })
  if (count === 0) return null
  if (open.activityCheckSentAt) {
    void resolveDutyActivityCheck(open.activityCheckChannelId, open.activityCheckMessageId, resolvedText)
  }
  queueDiscordDutyStatusUpdate()
  return { ...open, clockOutAt: now }
}

export async function clockOut(agentId: string, source: 'dashboard' | 'discord') {
  return closeOpenSession(agentId, source, '✅ Du hast dich selbst ausgestempelt.')
}

/** Leitung stempelt einen anderen Agent aus, z. B. wenn er das Ausstempeln vergessen hat. */
export async function clockOutByAdmin(agentId: string, actorName: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { firstName: true, lastName: true } })
  if (!agent) throw new DutyClockError('Agent nicht gefunden.', 404)
  const closed = await closeOpenSession(agentId, 'admin', `⏹️ Du wurdest von ${actorName} ausgestempelt.`)
  if (!closed) throw new DutyClockError(`${agentName(agent)} ist aktuell nicht eingestempelt.`, 409)
  const duration = formatDuration(closed.clockOutAt.getTime() - closed.clockInAt.getTime())
  await postDutyAdminLog(`⏹️ **${agentName(agent)}** wurde von **${actorName}** nach \`${duration}\` ausgestempelt.`)
  return closed
}

/** Bestätigt die Aktivitätsabfrage; die nächste Abfrage folgt erst nach der vollen Wartezeit. */
export async function confirmDutyActivity(sessionId: string, agentId: string) {
  const session = await prisma.dutyTimeSession.findFirst({ where: { id: sessionId, agentId } })
  if (!session) throw new DutyClockError('Diese Abfrage gehört nicht zu deiner Dienstzeit.', 404)
  if (session.clockOutAt) {
    throw new DutyClockError(session.autoClockedOut
      ? 'Du wurdest bereits automatisch ausgestempelt. Bitte stemple neu ein.'
      : 'Diese Dienstzeit ist bereits beendet.', 409)
  }
  if (!session.activityCheckSentAt) return session
  const now = new Date()
  const { count } = await prisma.dutyTimeSession.updateMany({
    where: { id: session.id, clockOutAt: null },
    data: { activityConfirmedAt: now, activityCheckSentAt: null, activityCheckChannelId: null, activityCheckMessageId: null },
  })
  if (count === 0) throw new DutyClockError('Du wurdest bereits automatisch ausgestempelt. Bitte stemple neu ein.', 409)
  void resolveDutyActivityCheck(session.activityCheckChannelId, session.activityCheckMessageId, '✅ Danke – du bleibst eingestempelt.')
  return session
}

export async function setDutyMode(mode: DutyMode, actorName: string) {
  const previous = await getDutyMode()
  if (previous === mode) return { changed: false }
  const now = new Date()
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: DUTY_MODE_SETTING_KEY },
      update: { value: mode },
      create: { key: DUTY_MODE_SETTING_KEY, value: mode },
    }),
    // Offene Sessions der jeweils anderen Quelle beenden, sonst liefen sie unbemerkt weiter.
    mode === 'manual'
      ? prisma.playtimeSession.updateMany({ where: { endedAt: null }, data: { endedAt: now } })
      : prisma.dutyTimeSession.updateMany({ where: { clockOutAt: null }, data: { clockOutAt: now, clockOutSource: 'mode-switch' } }),
  ])
  await announceDutyModeChange(mode, actorName).catch((error) => {
    console.error('[ManualDuty] Ankündigung des Moduswechsels fehlgeschlagen:', error)
  })
  return { changed: true }
}

async function sendDueActivityChecks(now: Date) {
  const threshold = new Date(now.getTime() - DUTY_ACTIVITY_CHECK_AFTER_MS)
  const due = await prisma.dutyTimeSession.findMany({
    where: {
      clockOutAt: null,
      activityCheckSentAt: null,
      OR: [
        { activityConfirmedAt: null, clockInAt: { lte: threshold } },
        { activityConfirmedAt: { lte: threshold } },
      ],
    },
    include: { agent: { select: { firstName: true, lastName: true, discordId: true } } },
    take: 50,
  })
  for (const session of due) {
    // Erst beanspruchen, dann senden: mehrere Instanzen schicken so keine doppelte Abfrage.
    const { count } = await prisma.dutyTimeSession.updateMany({
      where: { id: session.id, clockOutAt: null, activityCheckSentAt: null },
      data: { activityCheckSentAt: now },
    })
    if (count === 0) continue
    const message = await sendDutyActivityCheck({
      sessionId: session.id,
      discordId: session.agent.discordId,
      agentName: agentName(session.agent),
      clockInAt: session.clockInAt,
    }).catch((error) => {
      console.error('[ManualDuty] Aktivitätsabfrage konnte nicht gesendet werden:', error)
      return null
    })
    if (message) {
      await prisma.dutyTimeSession.updateMany({
        where: { id: session.id, activityCheckSentAt: now },
        data: { activityCheckChannelId: message.channelId, activityCheckMessageId: message.messageId },
      })
    }
  }
}

async function clockOutUnanswered(now: Date) {
  const expired = await prisma.dutyTimeSession.findMany({
    where: { clockOutAt: null, activityCheckSentAt: { lte: new Date(now.getTime() - DUTY_ACTIVITY_RESPONSE_MS) } },
    include: { agent: { select: { firstName: true, lastName: true } } },
    take: 50,
  })
  let changed = false
  for (const session of expired) {
    const sentAt = session.activityCheckSentAt!
    // Die Dienstzeit endet mit der unbeantworteten Abfrage, nicht erst eine Minute später.
    const { count } = await prisma.dutyTimeSession.updateMany({
      where: { id: session.id, clockOutAt: null, activityCheckSentAt: sentAt },
      data: { clockOutAt: sentAt, clockOutSource: 'activity-check', autoClockedOut: true },
    })
    if (count === 0) continue
    changed = true
    const duration = formatDuration(sentAt.getTime() - session.clockInAt.getTime())
    await resolveDutyActivityCheck(session.activityCheckChannelId, session.activityCheckMessageId,
      `⏹️ Keine Antwort erhalten – du wurdest automatisch ausgestempelt (Dienstzeit ${duration}). Stemple neu ein, falls du noch im Dienst bist.`)
    await postDutyAdminLog(`⏹️ **${agentName(session.agent)}** wurde nach \`${duration}\` automatisch ausgestempelt (Aktivitätsabfrage unbeantwortet).`)
  }
  return changed
}

async function closeTerminatedSessions(now: Date) {
  const { count } = await prisma.dutyTimeSession.updateMany({
    where: { clockOutAt: null, agent: { status: 'TERMINATED' } },
    data: { clockOutAt: now, clockOutSource: 'terminated' },
  })
  return count > 0
}

export async function runManualDutyTick(now = new Date()) {
  if (tickRunning) return
  tickRunning = true
  try {
    if (await getDutyMode() !== 'manual') return
    const terminated = await closeTerminatedSessions(now)
    await sendDueActivityChecks(now)
    const autoClosed = await clockOutUnanswered(now)
    if (terminated || autoClosed || now.getTime() - lastPanelRefresh >= PANEL_REFRESH_MS) {
      lastPanelRefresh = now.getTime()
      queueDiscordDutyStatusUpdate()
    }
  } finally {
    tickRunning = false
  }
}

export function ensureManualDutyWorker() {
  if (workerStarted || typeof setInterval !== 'function') return
  workerStarted = true
  setInterval(() => {
    void runManualDutyTick().catch((error) => {
      console.error('[ManualDuty] Aktivitätsprüfung fehlgeschlagen:', error)
    })
  }, TICK_MS).unref?.()
}

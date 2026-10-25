import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { queueDiscordHrEvent } from '@/lib/discord/discord-integration'
import { formatDate } from '@/lib/utils'

/**
 * Interne Lizenzen (Konzept „Lizenzen Intern“): von Hand erteilen und entziehen.
 * Nach einem Entzug läuft die Sperrfrist der Lizenzart; vorher lässt sich die
 * Lizenz nur bewusst übersteuert (mit Begründung) wieder erteilen.
 */

export class LicenseError extends Error {}

type Actor = { id: string; displayName: string; discordId?: string | null }

const DAY_MS = 24 * 60 * 60 * 1000

export type LicenseState = 'NONE' | 'GRANTED' | 'REVOKED'

export type AgentLicenseRow = {
  license: { id: string; key: string; label: string; description: string | null; cooldownDays: number }
  state: LicenseState
  /** Nach einem Entzug: frühestens ab dann wieder erteilbar. */
  regainableAt: string | null
  /** Seit wann der aktuelle Stand gilt. */
  since: string | null
}

export type AgentLicenseHistoryEntry = {
  id: string
  licenseLabel: string
  action: 'GRANTED' | 'REVOKED'
  reason: string | null
  regainableAt: string | null
  overrodeCooldown: boolean
  bulk: boolean
  sanction: { id: string; label: string } | null
  actorName: string | null
  createdAt: string
}

function sanctionLabel(sanction: { penalGrade: string; level: string; createdAt: Date }) {
  return `Penal Grade ${sanction.penalGrade} · Stufe ${sanction.level} · ${formatDate(sanction.createdAt)}`
}

/** Alle aktiven Lizenzarten mit dem Stand beim Agent, dazu die Historie und Sanktionen zum Verknüpfen. */
export async function getAgentLicenses(agentId: string) {
  const [licenses, states, events, sanctions] = await Promise.all([
    prisma.license.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    prisma.agentLicense.findMany({ where: { agentId } }),
    prisma.agentLicenseEvent.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        license: { select: { label: true } },
        actor: { select: { displayName: true } },
        sanction: { select: { id: true, penalGrade: true, level: true, createdAt: true } },
      },
    }),
    prisma.sanction.findMany({
      where: { agentId, status: { not: 'REVOKED' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, penalGrade: true, level: true, reason: true, createdAt: true },
    }),
  ])
  const stateByLicense = new Map(states.map((state) => [state.licenseId, state]))

  const rows: AgentLicenseRow[] = licenses.map((license) => {
    const state = stateByLicense.get(license.id)
    return {
      license: { id: license.id, key: license.key, label: license.label, description: license.description, cooldownDays: license.cooldownDays },
      state: state?.status ?? 'NONE',
      regainableAt: state?.status === 'REVOKED' && state.regainableAt ? state.regainableAt.toISOString() : null,
      since: state?.updatedAt.toISOString() ?? null,
    }
  })

  const history: AgentLicenseHistoryEntry[] = events.map((event) => ({
    id: event.id,
    licenseLabel: event.license.label,
    action: event.action,
    reason: event.reason,
    regainableAt: event.regainableAt?.toISOString() ?? null,
    overrodeCooldown: event.overrodeCooldown,
    bulk: event.bulk,
    sanction: event.sanction ? { id: event.sanction.id, label: sanctionLabel(event.sanction) } : null,
    actorName: event.actor?.displayName ?? null,
    createdAt: event.createdAt.toISOString(),
  }))

  return {
    licenses: rows,
    history,
    sanctions: sanctions.map((sanction) => ({
      id: sanction.id,
      label: `${sanctionLabel(sanction)} – ${sanction.reason.length > 60 ? `${sanction.reason.slice(0, 59)}…` : sanction.reason}`,
    })),
  }
}

type ChangeInput = {
  agentId: string
  licenseId: string
  action: 'grant' | 'revoke'
  reason?: string | null
  sanctionId?: string | null
  /** Erteilen trotz laufender Sperrfrist. */
  overrideCooldown?: boolean
  actor: Actor
}

export async function changeAgentLicense(input: ChangeInput) {
  const reason = input.reason?.trim() || null
  const [agent, license, current] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true, status: true, rankId: true, rank: { select: { name: true, color: true } } },
    }),
    prisma.license.findUnique({ where: { id: input.licenseId } }),
    prisma.agentLicense.findUnique({ where: { agentId_licenseId: { agentId: input.agentId, licenseId: input.licenseId } } }),
  ])
  if (!agent) throw new LicenseError('Agent nicht gefunden')
  if (!license) throw new LicenseError('Lizenz nicht gefunden')
  if (agent.status === 'TERMINATED') throw new LicenseError('Bei ausgeschiedenen Agents lassen sich Lizenzen nicht mehr ändern')

  const now = new Date()
  let regainableAt: Date | null = null
  let overrodeCooldown = false

  if (input.action === 'grant') {
    if (!license.active) throw new LicenseError('Diese Lizenzart ist deaktiviert')
    if (current?.status === 'GRANTED') throw new LicenseError('Die Lizenz ist bereits erteilt')
    const blockedUntil = current?.status === 'REVOKED' && current.regainableAt && current.regainableAt > now ? current.regainableAt : null
    if (blockedUntil) {
      if (!input.overrideCooldown) throw new LicenseError(`Sperrfrist läuft noch bis ${formatDate(blockedUntil)}`)
      if (!reason) throw new LicenseError('Zum Übersteuern der Sperrfrist ist eine Begründung nötig')
      overrodeCooldown = true
    }
  } else {
    if (current?.status !== 'GRANTED') throw new LicenseError('Die Lizenz ist nicht erteilt')
    if (!reason || reason.length < 3) throw new LicenseError('Bitte einen Grund für den Entzug angeben')
    if (input.sanctionId) {
      const sanction = await prisma.sanction.findFirst({ where: { id: input.sanctionId, agentId: agent.id }, select: { id: true } })
      if (!sanction) throw new LicenseError('Sanktion gehört nicht zu diesem Agent')
    }
    regainableAt = license.cooldownDays > 0 ? new Date(now.getTime() + license.cooldownDays * DAY_MS) : null
  }

  const status = input.action === 'grant' ? 'GRANTED' : 'REVOKED'
  await prisma.$transaction([
    prisma.agentLicense.upsert({
      where: { agentId_licenseId: { agentId: agent.id, licenseId: license.id } },
      update: { status, regainableAt },
      create: { agentId: agent.id, licenseId: license.id, status, regainableAt },
    }),
    prisma.agentLicenseEvent.create({
      data: {
        agentId: agent.id,
        licenseId: license.id,
        action: status,
        reason,
        sanctionId: input.action === 'revoke' ? input.sanctionId || null : null,
        overrodeCooldown,
        regainableAt,
        actorId: input.actor.id,
      },
    }),
  ])

  await createAuditLog({
    action: input.action === 'grant' ? 'LICENSE_GRANTED' : 'LICENSE_REVOKED',
    userId: input.actor.id,
    agentId: agent.id,
    newValue: license.label,
    details: [reason, overrodeCooldown ? 'Sperrfrist übersteuert' : null, regainableAt ? `wieder möglich ab ${formatDate(regainableAt)}` : null]
      .filter(Boolean)
      .join(' · ') || undefined,
  })

  const fields = [
    { name: 'Lizenz', value: `\`${license.label}\`` },
    reason ? { name: input.action === 'grant' ? 'Notiz' : 'Grund', value: reason } : null,
    regainableAt ? { name: 'Wieder möglich ab', value: `<t:${Math.floor(regainableAt.getTime() / 1000)}:D>` } : null,
    overrodeCooldown ? { name: 'Hinweis', value: 'Vor Ablauf der Sperrfrist erteilt' } : null,
  ].filter((field): field is { name: string; value: string } => Boolean(field))
  queueDiscordHrEvent({
    type: input.action === 'grant' ? 'licenseGranted' : 'licenseRevoked',
    title: `${input.action === 'grant' ? 'Lizenz erteilt' : 'Lizenz entzogen'}: ${license.label}`,
    agent,
    actor: input.actor,
    fields,
  })
}

/**
 * Erteilt eine Lizenz allen Agents im Dienst, die sie noch nie hatten (Erstausstattung,
 * z. B. Fahrlizenz). Entzogene Lizenzen bleiben entzogen. Bewusst ohne Discord-Meldung
 * je Agent – das wären auf einen Schlag Dutzende Pings.
 */
export async function grantLicenseToAllActive(licenseId: string, actor: Actor) {
  const license = await prisma.license.findUnique({ where: { id: licenseId } })
  if (!license) throw new LicenseError('Lizenz nicht gefunden')
  if (!license.active) throw new LicenseError('Diese Lizenzart ist deaktiviert')

  const agents = await prisma.agent.findMany({
    where: { status: { not: 'TERMINATED' }, licenses: { none: { licenseId } } },
    select: { id: true },
  })
  if (agents.length) {
    await prisma.$transaction([
      prisma.agentLicense.createMany({
        data: agents.map((agent) => ({ agentId: agent.id, licenseId, status: 'GRANTED' as const })),
        skipDuplicates: true,
      }),
      prisma.agentLicenseEvent.createMany({
        data: agents.map((agent) => ({ agentId: agent.id, licenseId, action: 'GRANTED' as const, bulk: true, reason: 'Erstausstattung', actorId: actor.id })),
      }),
    ])
  }
  await createAuditLog({
    action: 'LICENSE_GRANTED_BULK',
    userId: actor.id,
    newValue: license.label,
    details: `${agents.length} Agents`,
  })
  return { granted: agents.length }
}

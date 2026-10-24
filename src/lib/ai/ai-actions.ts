import { prisma } from '../prisma'
import type { CurrentUser } from '../auth'
import { createAuditLog } from '../audit/audit'
import { isUniqueConstraintError } from '../core/prisma-errors'
import { notifyInvestigationTeam } from '../core/notifications-server'
import { queueDiscordInvestigationEvent } from '../discord/discord-integration'
import { queueForumTask, refreshInvestigationForumCard } from '../investigations/investigation-forum'
import {
  INVESTIGATION_PERSON_ROLE_LABELS,
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
} from '../investigations/investigations'
import { nextPersonNumber } from '../investigations/investigations-server'
import { buildAgentNameMatcher, normalizePersonName } from '../storage-logs/storage-logs'
import type { AiChanges, AiThreadPlan } from './ai-prompts'
import { hasChanges, NO_ACTIONS, splitName, type Named, type Participant, type ProposalActions } from './ai-proposal-actions'

/**
 * KI-Vorschlag aus dem Akten-Beitrag gegen die Datenbank auflösen und
 * ausführen. Die KI liefert nur Namen und Werte; hier werden sie gegen Agents,
 * Personen- und Fahrzeugregister abgeglichen. Gespeichert wird das Ergebnis am
 * Vorschlag und erst beim Klick auf „Übernehmen“ ausgeführt.
 */

const plateKey = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, '')

type ResolveContext = {
  investigationId: string
  authorDiscordId: string
  attachments: { images: number; videos: number }
}

/** Plan der KI gegen die Datenbank auflösen – nur Eindeutiges wird zur Aktion. */
export async function resolvePlan(plan: Pick<AiThreadPlan, 'kind' | 'changes'>, context: ResolveContext): Promise<ProposalActions> {
  const changes: AiChanges = plan.changes
  const investigation = await prisma.investigation.findUniqueOrThrow({
    where: { id: context.investigationId },
    select: {
      status: true, priority: true, title: true, leadAgentId: true,
      assignees: { select: { agentId: true } },
      persons: { select: { personId: true, role: true } },
      vehicles: { select: { vehicleId: true } },
    },
  })
  const actions: ProposalActions = { ...NO_ACTIONS, entryKind: plan.kind ?? 'NOTE', attachments: context.attachments, unresolved: [] }

  if (changes.status && changes.status !== investigation.status) actions.status = { from: investigation.status, to: changes.status }
  if (changes.priority && changes.priority !== investigation.priority) actions.priority = { from: investigation.priority, to: changes.priority }
  if (changes.title && changes.title !== investigation.title) actions.title = { from: investigation.title, to: changes.title }

  // Agents: „ich“ ist der Verfasser, sonst Namensabgleich wie bei den Lagerlogs.
  // Auch für Personen nötig: ein Agent („Ben Geber“) ist nie eine Person der Akte.
  const needsAgents = changes.leadAgent || changes.addAssignees.length || changes.removeAssignees.length || changes.agents.length || changes.persons.length
  let matchAgent: ((name: string) => string | null) | null = null
  let participantOf: (id: string) => Participant | null = () => null
  if (needsAgents) {
    const agents = await prisma.agent.findMany({
      select: { id: true, firstName: true, lastName: true, badgeNumber: true, status: true, discordId: true, rank: { select: { name: true } }, user: { select: { discordId: true } } },
    })
    const match = buildAgentNameMatcher(agents.filter((agent) => agent.status !== 'TERMINATED'))
    matchAgent = match
    participantOf = (id) => {
      const agent = agents.find((row) => row.id === id)
      return agent ? { id, name: `${agent.firstName} ${agent.lastName}`, badgeNumber: agent.badgeNumber, rank: agent.rank?.name ?? null } : null
    }
    const nameOf = new Map(agents.map((agent) => [agent.id, `${agent.firstName} ${agent.lastName}`]))
    const author = agents.find((agent) => agent.status !== 'TERMINATED' && (agent.discordId === context.authorDiscordId || agent.user?.discordId === context.authorDiscordId))
    const resolve = (name: string): Named | null => {
      const id = /^(ich|mich|mir|selbst)$/i.test(name.trim()) ? author?.id ?? null : match(name)
      if (!id) {
        actions.unresolved.push(`Agent „${name}“`)
        return null
      }
      return { id, name: nameOf.get(id) ?? name }
    }
    if (changes.leadAgent) {
      const lead = resolve(changes.leadAgent)
      if (lead && lead.id !== investigation.leadAgentId) actions.leadAgent = lead
    }
    const assigned = new Set(investigation.assignees.map((row) => row.agentId))
    const unique = (list: Named[]) => [...new Map(list.map((agent) => [agent.id, agent])).values()]
    actions.addAssignees = unique(changes.addAssignees.map(resolve).filter((agent): agent is Named => !!agent && !assigned.has(agent.id)))
    actions.removeAssignees = unique(changes.removeAssignees.map(resolve).filter((agent): agent is Named => !!agent && assigned.has(agent.id)))
    for (const name of changes.agents) {
      const id = match(name)
      // Der Verfasser steht ohnehin am Eintrag.
      const participant = id && id !== author?.id ? participantOf(id) : null
      if (participant && !actions.participants.some((entry) => entry.id === participant.id)) actions.participants.push(participant)
    }
  }

  // Personen: vorhandene im Register verknüpfen, sonst neu anlegen. Mehrdeutiges bleibt offen.
  const linked = new Set(investigation.persons.map((row) => `${row.personId}:${row.role}`))
  for (const { name, role } of changes.persons) {
    // Ein FIB-Agent („Ben Geber“) wird Beteiligter am Eintrag, keine Person in der Akte.
    const agentId = matchAgent?.(name)
    if (agentId) {
      const participant = participantOf(agentId)
      if (participant && !actions.participants.some((entry) => entry.id === participant.id)) actions.participants.push(participant)
      continue
    }
    const split = splitName(name)
    if (!split) {
      actions.unresolved.push(`Person „${name}“ (Vor- und Nachname nötig)`)
      continue
    }
    const candidates = await prisma.person.findMany({ where: { lastName: split.lastName }, select: { id: true, firstName: true, lastName: true }, take: 20 })
    const hits = candidates.filter((person) => normalizePersonName(person.firstName) === normalizePersonName(split.firstName))
    if (hits.length > 1) {
      actions.unresolved.push(`Person „${name}“ (mehrfach im Register)`)
      continue
    }
    const person = hits[0]
    if (person && linked.has(`${person.id}:${role}`)) continue
    if (actions.persons.some((entry) => normalizePersonName(`${entry.firstName} ${entry.lastName}`) === normalizePersonName(name) && entry.role === role)) continue
    actions.persons.push(person
      ? { personId: person.id, firstName: person.firstName, lastName: person.lastName, role }
      : { personId: null, ...split, role })
  }

  // Fahrzeuge: nur verknüpfen, was im Register steht – Kennzeichen tolerant verglichen.
  if (changes.vehicles.length) {
    const attached = new Set(investigation.vehicles.map((row) => row.vehicleId))
    const registered = await prisma.vehicle.findMany({ where: { plate: { not: null } }, select: { id: true, plate: true, model: true } })
    for (const plate of changes.vehicles) {
      const hits = registered.filter((vehicle) => vehicle.plate && plateKey(vehicle.plate) === plateKey(plate))
      if (hits.length !== 1) {
        actions.unresolved.push(`Fahrzeug „${plate}“ (${hits.length ? 'mehrfach' : 'nicht'} im Register)`)
        continue
      }
      const vehicle = hits[0]
      if (attached.has(vehicle.id) || actions.vehicles.some((entry) => entry.id === vehicle.id)) continue
      actions.vehicles.push({ id: vehicle.id, name: [vehicle.plate, vehicle.model].filter(Boolean).join(' · ') })
    }
  }

  return actions
}

/**
 * Änderungen ausführen – mit den Rechten des Verfassers. Gibt eine kurze
 * Zusammenfassung für Audit-Log und Antwort zurück.
 */
export async function applyActions(investigationId: string, actions: ProposalActions, user: CurrentUser) {
  if (!hasChanges(actions)) return []
  const before = await prisma.investigation.findUniqueOrThrow({
    where: { id: investigationId },
    select: { status: true, closedAt: true, caseNumber: true },
  })
  const done: string[] = []

  const status = actions.status?.to
  await prisma.investigation.update({
    where: { id: investigationId },
    data: {
      ...(status ? { status, closedAt: status === 'CLOSED' || status === 'ARCHIVED' ? before.closedAt ?? new Date() : null } : {}),
      ...(actions.priority ? { priority: actions.priority.to } : {}),
      ...(actions.title ? { title: actions.title.to } : {}),
      ...(actions.leadAgent ? { leadAgent: { connect: { id: actions.leadAgent.id } } } : {}),
    },
    select: { id: true },
  })
  if (status) done.push(`Status ${INVESTIGATION_STATUS_LABELS[status]}`)
  if (actions.priority) done.push(`Priorität ${INVESTIGATION_PRIORITY_LABELS[actions.priority.to]}`)
  if (actions.title) done.push(`Titel „${actions.title.to}“`)
  if (actions.leadAgent) done.push(`Fallführung ${actions.leadAgent.name}`)

  if (actions.addAssignees.length) {
    await prisma.investigationAssignee.createMany({
      data: actions.addAssignees.map((agent) => ({ investigationId, agentId: agent.id, addedById: user.id })),
      skipDuplicates: true,
    })
    done.push(`Ermittler hinzu: ${actions.addAssignees.map((agent) => agent.name).join(', ')}`)
  }
  if (actions.removeAssignees.length) {
    await prisma.investigationAssignee.deleteMany({ where: { investigationId, agentId: { in: actions.removeAssignees.map((agent) => agent.id) } } })
    done.push(`Ermittler entfernt: ${actions.removeAssignees.map((agent) => agent.name).join(', ')}`)
  }

  for (const person of actions.persons) {
    let personId = person.personId
    if (!personId) {
      const personNumber = await nextPersonNumber()
      const created = await prisma.person.create({
        data: { personNumber, firstName: person.firstName, lastName: person.lastName, createdById: user.id },
        select: { id: true },
      })
      personId = created.id
      await createAuditLog({ action: 'PERSON_CREATED', userId: user.id, details: `Personenakte ${personNumber}: ${person.firstName} ${person.lastName} angelegt (KI-Vorschlag)` })
    }
    try {
      await prisma.investigationPerson.create({ data: { investigationId, personId, role: person.role }, select: { id: true } })
      done.push(`${person.firstName} ${person.lastName} als ${INVESTIGATION_PERSON_ROLE_LABELS[person.role]}`)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  for (const vehicle of actions.vehicles) {
    try {
      await prisma.investigationVehicle.create({ data: { investigationId, vehicleId: vehicle.id }, select: { id: true } })
      done.push(`Fahrzeug ${vehicle.name}`)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  const investigation = await prisma.investigation.update({
    where: { id: investigationId },
    data: { updatedAt: new Date() },
    select: { id: true, caseNumber: true, title: true, status: true, priority: true, leadAgent: { select: { firstName: true, lastName: true } } },
  })
  await createAuditLog({
    action: 'INVESTIGATION_UPDATED',
    userId: user.id,
    details: `Akte ${investigation.caseNumber} per KI-Vorschlag aus Discord geändert: ${done.join('; ')}`,
  })
  await notifyInvestigationTeam({
    investigation,
    actorId: user.id,
    addedAssigneeIds: actions.addAssignees.map((agent) => agent.id),
    newLeadAgentId: actions.leadAgent?.id ?? null,
  })

  if (actions.status) {
    const closing = investigation.status === 'CLOSED' || investigation.status === 'ARCHIVED'
    queueDiscordInvestigationEvent({
      type: closing ? 'closed' : 'status',
      investigationId,
      caseNumber: investigation.caseNumber,
      title: investigation.title,
      leadAgentName: investigation.leadAgent ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName}` : null,
      actorName: user.displayName,
      rows: [
        { label: 'Vorher', value: INVESTIGATION_STATUS_LABELS[actions.status.from] },
        { label: 'Jetzt', value: INVESTIGATION_STATUS_LABELS[investigation.status] },
        { label: 'Priorität', value: INVESTIGATION_PRIORITY_LABELS[investigation.priority] },
      ],
    })
  } else {
    queueForumTask('Aktenkarte aktualisieren', () => refreshInvestigationForumCard(investigationId))
  }
  return done
}

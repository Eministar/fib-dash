import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { updateTrainingsSchema } from '@/lib/validations/agent'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordHrEvent, queueAgentRoleSync } from '@/lib/discord-integration'
import { isTrainingAvailableForRank, withAgentTrainingRows } from '@/lib/agent-trainings'

function trainingStateLabel(completed: boolean) {
  return completed ? 'abgeschlossen' : 'offen'
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['agent-trainings:manage'])
    const { id } = await params
    const body = await req.json()
    const parsed = updateTrainingsSchema.safeParse(body)
    if (!parsed.success) return error('Ungültige Daten')

    const previousAgent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        rank: true,
        trainings: { include: { training: { include: { minRank: true } } } },
      },
    })
    if (!previousAgent) return notFound('Agent')

    const trainings = await prisma.training.findMany({
      include: { minRank: true },
      orderBy: { sortOrder: 'asc' },
    })
    const trainingById = new Map(trainings.map((training) => [training.id, training]))
    const previousByTrainingId = new Map(
      previousAgent.trainings.map((training) => [training.trainingId, training]),
    )

    for (const t of parsed.data.trainings) {
      const training = trainingById.get(t.trainingId)
      if (!training) return error('Ausbildung nicht gefunden')
      const wasCompleted = previousByTrainingId.get(t.trainingId)?.completed ?? false
      if (
        t.completed &&
        !wasCompleted &&
        !isTrainingAvailableForRank(training, previousAgent.rank) &&
        !parsed.data.overrideTrainingIds.includes(t.trainingId)
      ) {
        return error('Ausbildung ist für den Rang dieses Agents nicht verfügbar')
      }
    }

    const changedUpdates = parsed.data.trainings.filter((trainingUpdate) => (
      (previousByTrainingId.get(trainingUpdate.trainingId)?.completed ?? false) !== trainingUpdate.completed
    ))

    if (changedUpdates.length > 0) {
      const missingUpdates = changedUpdates.filter((trainingUpdate) => (
        !previousByTrainingId.has(trainingUpdate.trainingId)
      ))

      await prisma.$transaction([
        ...(missingUpdates.length > 0
          ? [prisma.agentTraining.createMany({
              data: missingUpdates.map((trainingUpdate) => ({
                agentId: id,
                trainingId: trainingUpdate.trainingId,
                completed: trainingUpdate.completed,
              })),
              skipDuplicates: true,
            })]
          : []),
        ...changedUpdates.map((trainingUpdate) => prisma.agentTraining.updateMany({
          where: { agentId: id, trainingId: trainingUpdate.trainingId },
          data: { completed: trainingUpdate.completed },
        })),
      ])
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        rank: true,
        trainings: { include: { training: { include: { minRank: true } } } },
      },
    })
    if (!agent) return notFound('Agent')
    const agentWithTrainingRows = withAgentTrainingRows(agent, trainings)

    const changedTrainings = changedUpdates.flatMap((trainingUpdate) => {
      const previous = previousByTrainingId.get(trainingUpdate.trainingId)

      const current = agentWithTrainingRows.trainings.find((training) => training.trainingId === trainingUpdate.trainingId)
      const label = current?.training.label ?? previous?.training.label ?? trainingUpdate.trainingId
      return [
        `${label}: ${trainingStateLabel(previous?.completed ?? false)} → ${trainingStateLabel(trainingUpdate.completed)}`,
      ]
    })
    const trainingChanges = changedUpdates.flatMap((trainingUpdate) => {
      const previous = previousByTrainingId.get(trainingUpdate.trainingId)

      const current = agentWithTrainingRows.trainings.find((training) => training.trainingId === trainingUpdate.trainingId)
      const training = current?.training ?? previous?.training
      const label = training?.label ?? trainingUpdate.trainingId

      return [{
        trainingId: trainingUpdate.trainingId,
        label,
        completed: trainingUpdate.completed,
        previousCompleted: previous?.completed ?? false,
      }]
    })

    if (changedTrainings.length > 0) {
      await createAuditLog({
        action: 'TRAININGS_UPDATED',
        userId: user.id,
        agentId: id,
        oldValue: `${previousAgent.firstName} ${previousAgent.lastName} (${previousAgent.badgeNumber})`,
        newValue: changedTrainings.join(', '),
        details: `Ausbildungsstand geändert: ${changedTrainings.join('; ')}`,
      })

      queueAgentRoleSync(id)
      queueDiscordHrEvent({
        type: 'training',
        title: `Ausbildung aktualisiert: ${agent.firstName} ${agent.lastName}`,
        agent: agentWithTrainingRows,
        actor: user,
        trainingChanges,
      })
    }

    return success({ message: 'Ausbildungen aktualisiert', agent: agentWithTrainingRows })
  } catch (e: unknown) {
    console.error('[AgentTrainings] Aktualisierung fehlgeschlagen:', e)
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (typeof e === 'object' && e !== null && 'code' in e) {
      const code = String((e as { code?: unknown }).code ?? '')
      if (code === 'P2002') return error('Diese Ausbildung ist dem Agent bereits zugeordnet', 409)
      if (code === 'P2003') return error('Agent oder Ausbildung existiert nicht mehr', 409)
    }
    return error(msg, 500)
  }
}

type RankOrder = {
  sortOrder: number
}

type TrainingMinimum = {
  id: string
  sortOrder: number
  minRankId?: string | null
  minRank?: RankOrder | null
}

type AgentTrainingRow<TTraining extends TrainingMinimum> = {
  id: string
  trainingId: string
  completed: boolean
  training: TTraining
}

type AgentWithTrainingRows<TTraining extends TrainingMinimum> = {
  id: string
  rank: RankOrder
  trainings: AgentTrainingRow<TTraining>[]
}

export function isTrainingAvailableForRank(training: TrainingMinimum, rank: RankOrder) {
  return !training.minRank || rank.sortOrder <= training.minRank.sortOrder
}

export function eligibleTrainingsForRank<TTraining extends TrainingMinimum>(trainings: TTraining[], rank: RankOrder) {
  return trainings
    .filter((training) => isTrainingAvailableForRank(training, rank))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function withAgentTrainingRows<
  TAgent extends AgentWithTrainingRows<TTraining>,
  TTraining extends TrainingMinimum,
>(agent: TAgent, trainings: TTraining[]) {
  const existingByTrainingId = new Map(agent.trainings.map((row) => [row.trainingId, row]))
  const rows = [...trainings].sort((a, b) => a.sortOrder - b.sortOrder).map((training) => {
    const existing = existingByTrainingId.get(training.id)
    if (existing) {
      return { ...existing, training }
    }

    return {
      id: `virtual-${agent.id}-${training.id}`,
      trainingId: training.id,
      completed: false,
      training,
    }
  })

  return {
    ...agent,
    trainings: rows,
  }
}

import { hasPermission, type Permission } from './permissions'
import { isTrainingAvailableForRank } from './agent-trainings'

export const agentTaskModules = {
  ACADEMY: { permission: 'academy:view', manage: 'academy:manage', label: 'Academy' },
  HR: { permission: 'hr:view', manage: 'hr:manage', label: 'Personalabteilung' },
  SRU: { permission: 'sru:view', manage: 'sru:manage', label: 'SRU' },
  AIR_SUPPORT: { permission: 'air-support:view', manage: 'air-support:manage', label: 'Air Support' },
  DETECTIVE: { permission: 'detective:view', manage: 'detective:manage', label: 'Detective' },
  INTERNAL_AFFAIRS: { permission: 'internal-affairs:view', manage: 'internal-affairs:manage', label: 'Internal Affairs' },
  LAD: { permission: 'lad:view', manage: 'lad:manage', label: 'LAD' },
} satisfies Record<string, { permission: Permission; manage: Permission; label: string }>

export function visibleAgentTaskModules(user: { permissions?: string[] | null }) {
  return (Object.keys(agentTaskModules) as (keyof typeof agentTaskModules)[]).filter(key => hasPermission(user, agentTaskModules[key].permission))
}

export type AgentOpenTask = {
  id: string
  title: string
  detail: string
  kind: 'training' | 'contract' | 'task'
  dueDate: string | null
  canComplete: boolean
  inProgress?: boolean
  overdue?: boolean
}

export function missingAgentTrainings(agent: { status: string; rank: { sortOrder: number }; trainings: { trainingId: string; completed: boolean }[] }, trainings: { id: string; label: string; sortOrder: number; minRank?: { sortOrder: number } | null }[]): AgentOpenTask[] {
  if (agent.status === 'TERMINATED') return []
  const completed = new Set(agent.trainings.filter(row => row.completed).map(row => row.trainingId))
  return trainings.filter(training => !completed.has(training.id) && isTrainingAvailableForRank(training, agent.rank)).map(training => ({
    id: training.id, title: training.label, detail: 'Ausbildung noch nicht abgeschlossen', kind: 'training', dueDate: null, canComplete: false,
  }))
}

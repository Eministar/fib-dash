import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { success, error, notFound, unauthorized, forbidden } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { agentTaskModules, missingAgentTrainings, visibleAgentTaskModules, type AgentOpenTask } from '@/lib/agents/agent-open-tasks'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agents:view')
    const { id } = await params
    const agent = await prisma.agent.findUnique({ where: { id }, select: { status: true, rank: { select: { sortOrder: true } }, trainings: { select: { trainingId: true, completed: true } } } })
    if (!agent) return notFound('Agent')
    if (agent.status === 'TERMINATED') return success([])
    const modules = visibleAgentTaskModules(user)
    const [trainings, contracts, tasks] = await Promise.all([
      prisma.training.findMany({ select: { id: true, label: true, sortOrder: true, minRank: { select: { sortOrder: true } } }, orderBy: { sortOrder: 'asc' } }),
      hasPermission(user, 'contracts:view') || hasPermission(user, 'contracts:manage')
        ? prisma.contract.findMany({ where: { agentId: id, status: { in: ['DRAFT', 'SENT'] } }, select: { id: true, title: true, status: true }, orderBy: { createdAt: 'asc' } }) : [],
      prisma.task.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, assignments: { some: { agentId: id } }, list: { archived: false, module: { in: modules } } },
        select: { id: true, title: true, status: true, dueDate: true, list: { select: { title: true, module: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    ])
    const items: AgentOpenTask[] = [
      ...tasks.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)).map(task => ({ id: task.id, title: task.title, detail: `${agentTaskModules[task.list.module].label} · ${task.list.title}`, kind: 'task' as const, dueDate: task.dueDate?.toISOString() ?? null, canComplete: hasPermission(user, agentTaskModules[task.list.module].manage), inProgress: task.status === 'IN_PROGRESS', overdue: !!task.dueDate && task.dueDate.getTime() < Date.now() })),
      ...contracts.map(contract => ({ id: contract.id, title: contract.title, detail: contract.status === 'DRAFT' ? 'Vertrag noch nicht versendet' : 'Unterschrift ausstehend', kind: 'contract' as const, dueDate: null, canComplete: false })),
      ...missingAgentTrainings(agent, trainings),
    ]
    return success(items)
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
    if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
    return error('Offene Aufgaben konnten nicht geladen werden.', 500)
  }
}

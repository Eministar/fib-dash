import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'

const taskInclude = {
  createdBy: { select: { id: true, displayName: true } },
  assignments: {
    include: {
      agent: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          badgeNumber: true,
          rank: { select: { id: true, name: true, color: true } },
        },
      },
    },
  },
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    if (!Array.isArray(body.agentIds)) return error('agentIds erforderlich')
    const agentIds: string[] = body.agentIds.filter(
      (v: unknown): v is string => typeof v === 'string',
    )

    const task = await prisma.task.findUnique({
      where: { id },
      include: { assignments: true, list: { select: { module: true } } },
    })
    if (!task) return notFound('Aufgabe')
    await requireTaskModuleManage(task.list.module)

    const current = new Set(task.assignments.map((a) => a.agentId))
    const next = new Set(agentIds)

    const toRemove: string[] = []
    const toAdd: string[] = []
    for (const oid of current) if (!next.has(oid)) toRemove.push(oid)
    for (const oid of next) if (!current.has(oid)) toAdd.push(oid)

    if (toAdd.length) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: toAdd } },
        select: { id: true },
      })
      const valid = new Set(agents.map((o) => o.id))
      const filtered = toAdd.filter((oid) => valid.has(oid))
      if (filtered.length) {
        await prisma.taskAssignment.createMany({
          data: filtered.map((agentId) => ({ taskId: id, agentId })),
        })
      }
    }

    if (toRemove.length) {
      await prisma.taskAssignment.deleteMany({
        where: { taskId: id, agentId: { in: toRemove } },
      })
    }

    const updated = await prisma.task.findUnique({ where: { id }, include: taskInclude })
    return success(updated)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

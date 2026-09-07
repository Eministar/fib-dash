import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'

const VALID_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: listId } = await params
    const body = await req.json()

    const list = await prisma.taskList.findUnique({ where: { id: listId } })
    if (!list) return notFound('Liste')
    const user = await requireTaskModuleManage(list.module)

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return error('Titel ist erforderlich')

    const priority =
      typeof body.priority === 'string' && VALID_PRIORITY.includes(body.priority)
        ? body.priority
        : 'NORMAL'

    let dueDate: Date | null = null
    if (body.dueDate) {
      const parsed = new Date(body.dueDate)
      if (!Number.isNaN(parsed.getTime())) dueDate = parsed
    }

    const last = await prisma.task.findFirst({
      where: { listId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const assigneeIds: string[] = Array.isArray(body.assigneeIds)
      ? body.assigneeIds.filter((v: unknown): v is string => typeof v === 'string')
      : []

    const task = await prisma.task.create({
      data: {
        listId,
        title,
        description: body.description?.toString().trim() || null,
        priority: priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
        dueDate,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: user.id,
        assignments: assigneeIds.length
          ? {
              create: assigneeIds.map((agentId) => ({ agentId })),
            }
          : undefined,
      },
      include: taskInclude,
    })

    return success(task, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

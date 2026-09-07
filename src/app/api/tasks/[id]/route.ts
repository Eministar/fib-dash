import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'

const VALID_STATUS = ['OPEN', 'IN_PROGRESS', 'COMPLETED']
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.task.findUnique({ where: { id }, include: { list: { select: { module: true } } } })
    if (!existing) return notFound('Aufgabe')
    await requireTaskModuleManage(existing.list.module)

    const data: Record<string, unknown> = {}

    if (typeof body.title === 'string') {
      const title = body.title.trim()
      if (!title) return error('Titel darf nicht leer sein')
      data.title = title
    }
    if ('description' in body) {
      const desc = body.description?.toString().trim()
      data.description = desc || null
    }
    if (typeof body.priority === 'string' && VALID_PRIORITY.includes(body.priority)) {
      data.priority = body.priority
    }
    if (typeof body.status === 'string' && VALID_STATUS.includes(body.status)) {
      data.status = body.status
      data.completedAt = body.status === 'COMPLETED' ? new Date() : null
    }
    if ('dueDate' in body) {
      if (!body.dueDate) {
        data.dueDate = null
      } else {
        const parsed = new Date(body.dueDate)
        if (!Number.isNaN(parsed.getTime())) data.dueDate = parsed
      }
    }
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: taskInclude,
    })

    return success(updated)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const existing = await prisma.task.findUnique({ where: { id }, include: { list: { select: { module: true } } } })
    if (!existing) return notFound('Aufgabe')
    await requireTaskModuleManage(existing.list.module)

    await prisma.task.delete({ where: { id } })
    return success({ message: 'Aufgabe gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

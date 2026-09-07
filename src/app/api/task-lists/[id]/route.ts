import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage, requireTaskModuleView } from '@/lib/module-permissions'

const taskListInclude = {
  createdBy: { select: { id: true, displayName: true } },
  tasks: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
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
    },
  },
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const list = await prisma.taskList.findUnique({
    where: { id },
    include: taskListInclude,
  })
  if (!list) return notFound('Liste')

  try {
    await requireTaskModuleView(list.module)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
  return success(list)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const list = await prisma.taskList.findUnique({ where: { id } })
    if (!list) return notFound('Liste')
    await requireTaskModuleManage(list.module)

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
    if (typeof body.color === 'string' && body.color) data.color = body.color
    if (typeof body.archived === 'boolean') data.archived = body.archived
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

    const updated = await prisma.taskList.update({
      where: { id },
      data,
      include: taskListInclude,
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

    const list = await prisma.taskList.findUnique({ where: { id } })
    if (!list) return notFound('Liste')
    await requireTaskModuleManage(list.module)

    await prisma.taskList.delete({ where: { id } })
    return success({ message: 'Liste gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

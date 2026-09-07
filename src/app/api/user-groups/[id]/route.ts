import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { sanitizePermissions } from '@/lib/permissions'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { userGroupDelegate } from '@/lib/prisma-delegates'

function serializeGroup<T extends {
  users: { id: string }[]
  memberships: { userId: string }[]
}>(group: T) {
  const userIds = new Set([
    ...group.users.map((user) => user.id),
    ...group.memberships.map((membership) => membership.userId),
  ])
  const { users, memberships, ...rest } = group
  return {
    ...rest,
    _count: { users: userIds.size },
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['groups:manage'])
    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return error('Name darf nicht leer sein')
      data.name = name
    }
    if ('description' in body) {
      data.description = typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null
    }
    if ('permissions' in body) data.permissions = sanitizePermissions(body.permissions)

    const group = await userGroupDelegate(prisma).update({
      where: { id },
      data,
      include: {
        users: { select: { id: true } },
        memberships: { select: { userId: true } },
      },
    })

    return success(serializeGroup(group))
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Benutzergruppe existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['groups:manage'])
    const { id } = await params

    const group = await userGroupDelegate(prisma).findUnique({
      where: { id },
      include: {
        users: { select: { id: true } },
        memberships: { select: { userId: true } },
      },
    })
    if (!group) return notFound('Benutzergruppe')

    // Löschen ist immer möglich: Mitgliedschaften (auch Discord-synchronisierte) werden
    // per Cascade entfernt, die Primärgruppen-Zuordnung der Benutzer per SetNull gelöst.
    await userGroupDelegate(prisma).delete({ where: { id } })
    return success({ message: 'Benutzergruppe gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

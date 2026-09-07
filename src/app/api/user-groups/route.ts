import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
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

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['groups:manage', 'users:manage'])

    const groups = await userGroupDelegate(prisma).findMany({
      include: {
        users: { select: { id: true } },
        memberships: { select: { userId: true } },
      },
      orderBy: { name: 'asc' },
    })
    return success(groups.map(serializeGroup))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['groups:manage'])
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return error('Name ist erforderlich')

    const group = await userGroupDelegate(prisma).create({
      data: {
        name,
        description: typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null,
        permissions: sanitizePermissions(body.permissions),
      },
      include: {
        users: { select: { id: true } },
        memberships: { select: { userId: true } },
      },
    })

    return success(serializeGroup(group), 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Benutzergruppe existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

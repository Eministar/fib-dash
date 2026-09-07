import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { success, error, unauthorized , forbidden } from '@/lib/api-response'
import { discordIdSchema } from '@/lib/validations/agent'

export async function PATCH(req: NextRequest) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return unauthorized()

  const body = await req.json()
  const parsed = discordIdSchema.safeParse(body.discordId)
  if (!parsed.success) return error(parsed.error.issues.map((issue) => issue.message).join(', '))

  if (parsed.data) {
    const existing = await prisma.user.findFirst({
      where: { discordId: parsed.data, NOT: { id: currentUser.id } },
      select: { id: true },
    })
    if (existing) return error('Discord-ID ist bereits mit einem anderen Benutzer verbunden')
  }

  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: { discordId: parsed.data ?? null },
    select: { id: true, username: true, displayName: true, discordId: true },
  })

  return success(user)
}


import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, requirePermission, verifyPassword } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

export async function PATCH(req: NextRequest) {
  let currentUser
  try {
    currentUser = await requirePermission('password:change')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const body = await req.json()
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  if (!currentPassword || !newPassword) return error('Aktuelles und neues Passwort sind erforderlich')
  if (newPassword.length < 6) return error('Neues Passwort muss mindestens 6 Zeichen haben')

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { passwordHash: true },
  })
  if (!user) return unauthorized()
  if (!user.passwordHash) return error('Dieser Account nutzt Discord-Login', 400)

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) return error('Aktuelles Passwort ist falsch', 403)

  await prisma.user.update({
    where: { id: currentUser.id },
    data: { passwordHash: await hashPassword(newPassword) },
  })

  return success({ message: 'Passwort geändert' })
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { queueCodenameBoardUpdate } from '@/lib/discord-integration'

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['settings:manage'])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const settings = await prisma.systemSetting.findMany()
  const map: Record<string, string> = {}
  settings.forEach((s) => { map[s.key] = s.value })
  return success(map)
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['settings:manage'])
    const body = await req.json()

    if (!body.key || body.value === undefined) return error('Key und Value sind erforderlich')
    if (body.key === 'codenames.prefix' && (typeof body.value !== 'string' || body.value.trim().length > 40 || /[\r\n`]/.test(body.value))) return error('Decknamen-Präfix muss ein einzeiliger Text mit höchstens 40 Zeichen sein')

    await prisma.systemSetting.upsert({
      where: { key: body.key },
      update: { value: String(body.value) },
      create: { key: body.key, value: String(body.value) },
    })

    if (body.key === 'codenames.prefix') queueCodenameBoardUpdate()
    return success({ message: 'Einstellung gespeichert' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { ORDNUNG_ICONS } from '@/lib/ordnungen-icons'

function slugify(input: string) {
  return input.trim().toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const body = await req.json()

    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (!label) return error('Bezeichnung ist erforderlich')

    const key = typeof body.key === 'string' && body.key.trim() ? slugify(body.key) : slugify(label)
    if (!key) return error('Bezeichnung ergibt keinen gültigen Key')

    const icon = typeof body.icon === 'string' && body.icon in ORDNUNG_ICONS ? body.icon : 'Library'
    const color = typeof body.color === 'string' && body.color ? body.color : '#4a8fd8'

    const category = await prisma.ordnungCategory.create({
      data: {
        key,
        label,
        description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
        icon,
        color,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
      },
    })

    return success(category, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Kategorie existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

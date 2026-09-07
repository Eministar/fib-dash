import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthContext, getCurrentUser } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { ORDNUNG_ICONS } from '@/lib/ordnungen-icons'

function slugify(input: string) {
  return input.trim().toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Ansehen: jeder eingeloggte User (keine spezielle Permission).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const [categories, ordnungen] = await Promise.all([
    prisma.ordnungCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    prisma.ordnung.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
  ])

  return success({
    categories: categories.map((c) => ({
      id: c.id, key: c.key, label: c.label, description: c.description,
      icon: c.icon, color: c.color, sortOrder: c.sortOrder,
    })),
    ordnungen: ordnungen.map((o) => ({
      id: o.id, slug: o.slug, title: o.title, description: o.description,
      buttonLabel: o.buttonLabel, icon: o.icon, categoryId: o.categoryId, sortOrder: o.sortOrder,
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuthContext('ordnungen:manage')
    const body = await req.json()

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return error('Titel ist erforderlich')
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId : ''
    if (!categoryId) return error('Kategorie ist erforderlich')

    const category = await prisma.ordnungCategory.findUnique({ where: { id: categoryId } })
    if (!category) return error('Kategorie nicht gefunden', 400)

    const slug = typeof body.slug === 'string' && body.slug.trim() ? slugify(body.slug) : slugify(title)
    if (!slug) return error('Titel ergibt keinen gültigen Slug')

    const icon = typeof body.icon === 'string' && body.icon in ORDNUNG_ICONS ? body.icon : 'FileText'

    const ordnung = await prisma.ordnung.create({
      data: {
        slug,
        title,
        description: typeof body.description === 'string' ? body.description.trim() : '',
        buttonLabel: typeof body.buttonLabel === 'string' && body.buttonLabel.trim() ? body.buttonLabel.trim() : title,
        icon,
        content: typeof body.content === 'string' ? body.content : '',
        categoryId,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
        createdById: user.id,
      },
    })

    return success(ordnung, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Eine Ordnung mit diesem Slug existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

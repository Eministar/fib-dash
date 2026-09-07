import { NextRequest } from 'next/server'
import type { PressReleaseStatus } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { normalizePressReleaseInput, slugifyPressReleaseTitle } from '@/lib/press-releases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const releaseInclude = {
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
}

async function uniqueSlug(title: string, currentId?: string) {
  const base = slugifyPressReleaseTitle(title)
  let slug = base
  let suffix = 2

  while (await prisma.pressRelease.findFirst({
    where: currentId ? { slug, id: { not: currentId } } : { slug },
    select: { id: true },
  })) {
    slug = `${base}-${suffix}`
    suffix += 1
  }

  return slug
}

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope')

  if (scope === 'manage') {
    try {
      await requirePermission(['press:view', 'press:manage'])
    } catch (e: unknown) {
      return authError(e)
    }

    const releases = await prisma.pressRelease.findMany({
      include: releaseInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })
    return success(releases)
  }

  const releases = await prisma.pressRelease.findMany({
    where: { status: 'PUBLISHED' },
    include: releaseInclude,
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  })
  return success(releases)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('press:manage')
    const body = await req.json().catch(() => ({}))
    const { data, error: validationError } = normalizePressReleaseInput(body)
    if (!data) return error(validationError ?? 'Ungültige Eingabe')

    const now = new Date()
    const release = await prisma.pressRelease.create({
      data: {
        title: data.title,
        slug: await uniqueSlug(data.title),
        summary: data.summary,
        content: data.content,
        imageUrl: data.imageUrl,
        imageAlt: data.imageAlt,
        status: data.status as PressReleaseStatus,
        publishedAt: data.status === 'PUBLISHED' ? now : null,
        createdById: user.id,
        updatedById: user.id,
      },
      include: releaseInclude,
    })

    return success(release, 201)
  } catch (e: unknown) {
    return authError(e)
  }
}

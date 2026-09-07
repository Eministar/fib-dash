import { NextRequest } from 'next/server'
import type { PressReleaseStatus } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { normalizePressReleaseInput, slugifyPressReleaseTitle } from '@/lib/press-releases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const releaseInclude = {
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
}

async function uniqueSlug(title: string, currentId: string) {
  const base = slugifyPressReleaseTitle(title)
  let slug = base
  let suffix = 2

  while (await prisma.pressRelease.findFirst({
    where: { slug, id: { not: currentId } },
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const scope = req.nextUrl.searchParams.get('scope')

  if (scope === 'manage') {
    try {
      await requirePermission(['press:view', 'press:manage'])
    } catch (e: unknown) {
      return authError(e)
    }
  }

  const release = await prisma.pressRelease.findFirst({
    where: {
      OR: [{ id }, { slug: id }],
      ...(scope === 'manage' ? {} : { status: 'PUBLISHED' as const }),
    },
    include: releaseInclude,
  })

  if (!release) return notFound('Pressemitteilung')
  return success(release)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission('press:manage')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { data, error: validationError } = normalizePressReleaseInput(body)
    if (!data) return error(validationError ?? 'Ungültige Eingabe')

    const existing = await prisma.pressRelease.findUnique({ where: { id } })
    if (!existing) return notFound('Pressemitteilung')

    const publishedAt = data.status === 'PUBLISHED'
      ? existing.publishedAt ?? new Date()
      : data.status === 'DRAFT'
        ? null
        : existing.publishedAt

    const release = await prisma.pressRelease.update({
      where: { id },
      data: {
        title: data.title,
        slug: existing.title === data.title ? existing.slug : await uniqueSlug(data.title, id),
        summary: data.summary,
        content: data.content,
        imageUrl: data.imageUrl,
        imageAlt: data.imageAlt,
        status: data.status as PressReleaseStatus,
        publishedAt,
        updatedById: user.id,
      },
      include: releaseInclude,
    })

    return success(release)
  } catch (e: unknown) {
    return authError(e)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('press:manage')
    const { id } = await params
    const existing = await prisma.pressRelease.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return notFound('Pressemitteilung')

    await prisma.pressRelease.delete({ where: { id } })
    return success({ deleted: true })
  } catch (e: unknown) {
    return authError(e)
  }
}

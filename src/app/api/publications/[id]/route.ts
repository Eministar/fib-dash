import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { normalizeTable, publicationInput } from '@/lib/publications'
import { publicationFailure } from '@/lib/publications-server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requirePermission('publications:manage')
    const publication = await prisma.publication.findUnique({ where: { id: (await params).id } })
    return publication ? success(publication) : notFound('Aushang')
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('publications:manage')
    const { id } = await params
    const existing = await prisma.publication.findUnique({ where: { id } })
    if (!existing) return notFound('Aushang')
    const input = publicationInput.parse(await req.json())
    const publication = await prisma.publication.update({
      where: { id },
      data: {
        kind: input.kind,
        title: input.title,
        summary: input.summary || null,
        content: input.content,
        table: input.kind === 'TABLE' && input.table ? normalizeTable(input.table) : Prisma.DbNull,
        status: input.status,
        // Leer lassen behält den bisherigen Link, damit geteilte Links nicht brechen.
        slug: input.slug || existing.slug,
        access: input.access,
        roleIds: input.access === 'ROLES' ? input.roleIds : Prisma.DbNull,
        listed: input.listed,
        pinned: input.pinned,
        // Das Veröffentlichungsdatum bleibt beim Bearbeiten stabil, erst ein erneutes Veröffentlichen setzt es neu.
        publishedAt: input.status === 'PUBLISHED' ? existing.publishedAt ?? new Date() : existing.publishedAt,
      },
    })
    await createAuditLog({ action: 'PUBLICATION_UPDATED', userId: user.id, details: `Aushang „${publication.title}“ bearbeitet` })
    return success(publication)
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('publications:manage')
    const { id } = await params
    const existing = await prisma.publication.findUnique({ where: { id }, select: { title: true } })
    if (!existing) return notFound('Aushang')
    await prisma.publication.delete({ where: { id } })
    await createAuditLog({ action: 'PUBLICATION_DELETED', userId: user.id, details: `Aushang „${existing.title}“ gelöscht` })
    return success({ message: 'Aushang gelöscht' })
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}

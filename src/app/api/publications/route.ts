import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { publicationFailure } from '@/lib/publications-server'
import { createAuditLog } from '@/lib/audit'
import { normalizeTable, publicationInput, publicationSlug } from '@/lib/publications'

export async function GET() {
  try {
    await requirePermission('publications:manage')
    const items = await prisma.publication.findMany({
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true, slug: true, kind: true, title: true, summary: true, status: true, access: true, listed: true, pinned: true,
        publishedAt: true, updatedAt: true, createdBy: { select: { displayName: true } },
      },
    })
    return success(items)
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('publications:manage')
    const input = publicationInput.parse(await req.json())
    const publication = await prisma.publication.create({
      data: {
        slug: input.slug || publicationSlug(input.title, crypto.randomBytes(4).toString('hex')),
        kind: input.kind,
        title: input.title,
        summary: input.summary || null,
        content: input.content,
        table: input.kind === 'TABLE' && input.table ? normalizeTable(input.table) : undefined,
        status: input.status,
        access: input.access,
        roleIds: input.access === 'ROLES' ? input.roleIds : undefined,
        listed: input.listed,
        pinned: input.pinned,
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
        createdById: user.id,
      },
    })
    await createAuditLog({ action: 'PUBLICATION_CREATED', userId: user.id, details: `Aushang „${publication.title}“ angelegt` })
    return success(publication)
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}

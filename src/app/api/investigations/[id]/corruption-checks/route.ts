import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { error, forbidden, notFound, success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { canAccessInvestigation, investigationAccessInclude, linkedCorruptionCheckSelect } from '@/lib/investigations/investigations'
import { routeError } from '@/lib/investigations/investigations-server'
import { isUniqueConstraintError } from '@/lib/core/prisma-errors'

type Context = { params: Promise<{ id: string }> }
const inputSchema = z.object({ checkId: z.string().trim().min(1).max(191) }).strict()

export async function GET(_req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params
    const investigation = await prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude })
    if (!investigation) return notFound('Einsatzakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()
    const links = await prisma.investigationCorruptionCheck.findMany({
      where: { investigationId: id },
      select: { check: { select: linkedCorruptionCheckSelect } },
      orderBy: { createdAt: 'desc' },
    })
    return success(links.map(link => link.check))
  } catch (cause) { return routeError(cause) }
}

async function change(req: Request, { params }: Context, remove: boolean) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const parsed = inputSchema.safeParse(await req.json())
    if (!parsed.success) return error('Bitte eine gültige Korruptionskontrolle auswählen')
    const { checkId } = parsed.data
    const investigation = await prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude })
    if (!investigation) return notFound('Einsatzakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()
    if (!await prisma.corruptionCheck.findUnique({ where: { id: checkId }, select: { id: true } })) return notFound('Korruptionskontrolle')
    await prisma.$transaction(async tx => {
      if (remove) {
        const deleted = await tx.investigationCorruptionCheck.deleteMany({ where: { investigationId: id, checkId } })
        if (!deleted.count) return
      } else {
        await tx.investigationCorruptionCheck.create({ data: { investigationId: id, checkId } })
      }
      await createAuditLog({ action: remove ? 'INVESTIGATION_CORRUPTION_UNLINKED' : 'INVESTIGATION_CORRUPTION_LINKED', userId: user.id, details: `${investigation.caseNumber}: Korruptionskontrolle ${checkId} ${remove ? 'gelöst' : 'verknüpft'}` }, tx)
    })
    return success({ checkId }, remove ? 200 : 201)
  } catch (cause) {
    if (isUniqueConstraintError(cause)) return error('Diese Kontrolle ist bereits verknüpft', 409)
    if (cause instanceof SyntaxError) return error('Ungültige Anfrage')
    return routeError(cause)
  }
}

export async function POST(req: Request, context: Context) { return change(req, context, false) }
export async function DELETE(req: Request, context: Context) { return change(req, context, true) }

import { z } from 'zod'

import { error, forbidden, notFound, success, unauthorized } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit/audit'
import { AiError, entriesFromReport } from '@/lib/ai/ai-server'
import { MAX_REPORT_LENGTH } from '@/lib/ai/ai-prompts'
import { queueDiscordInvestigationEvent } from '@/lib/discord/discord-integration'
import { mergeCharges, readCharges } from '@/lib/investigations/charges'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations/investigations'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  report: z.string().trim().min(1, 'Bitte einen Bericht oder Stichwörter angeben.').max(MAX_REPORT_LENGTH),
}).strict()

/**
 * KI-Knopf in der Akte: Bericht → mehrere Chronologie-Einträge, direkt
 * gespeichert. Neue Straftatbestände werden der Akte hinzugefügt.
 * Einträge lassen sich danach wie gewohnt bearbeiten oder löschen.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const { report } = bodySchema.parse(await req.json())

    const investigation = await prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const plan = await entriesFromReport({ investigationId: id, report }, user)

    // Zeitpunkte leicht versetzt, damit die Reihenfolge der KI in der Chronologie erhalten bleibt.
    const base = Date.now() - plan.entries.length * 1000
    const created = await prisma.$transaction(plan.entries.map((entry, index) => prisma.investigationEntry.create({
      data: {
        investigationId: id, kind: entry.kind, title: entry.title, content: entry.content,
        occurredAt: new Date(base + index * 1000), participants: [], createdById: user.id,
      },
      select: { id: true, title: true },
    })))

    const charges = plan.charges.length ? mergeCharges(readCharges(investigation.charges), plan.charges) : null
    await prisma.investigation.update({
      where: { id },
      data: { updatedAt: new Date(), ...(charges ? { charges } : {}) },
      select: { id: true },
    })

    await createAuditLog({
      action: 'INVESTIGATION_ENTRY_CREATED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: ${created.length} Einträge per KI aus Bericht angelegt${plan.charges.length ? ` · Straftatbestände: ${plan.charges.map((charge) => charge.label).join(', ')}` : ''}`,
    })
    for (const entry of created) {
      queueDiscordInvestigationEvent({
        type: 'entry', investigationId: id, entryId: entry.id,
        caseNumber: investigation.caseNumber, title: investigation.title, actorName: user.displayName,
      })
    }

    return success({ created: created.length, charges: plan.charges, missing: plan.missing })
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
    if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
    if (cause instanceof AiError) return error(cause.message, cause.status)
    if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join('; '))
    if (cause instanceof SyntaxError) return error('Ungültiges JSON')
    if (cause instanceof Error && cause.message.startsWith('Die KI')) return error(cause.message, 502)
    console.error('[AI] Einträge aus Bericht fehlgeschlagen:', cause)
    return error('Die KI konnte keine Einträge anlegen.', 500)
  }
}

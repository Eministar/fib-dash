import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized , forbidden } from '@/lib/api-response'
import { actionsForGroup, allGroupedActions } from '@/lib/audit-log-groups'
import type { Prisma } from '@/generated/prisma/client'
import { runAuditLogCleanup } from '@/lib/audit-log-retention'

function clampNumber(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(['ADMIN', 'HR', 'LEADERSHIP'], ['logs:view'])
    void runAuditLogCleanup().catch((cleanupError) => {
      console.error('[AuditLogs] Automatische Bereinigung fehlgeschlagen:', cleanupError)
    })

    const { searchParams } = new URL(req.url)
    // `parseInt` liefert bei Müll NaN — das würde Prisma mit einem 500er
    // quittieren. Zusätzlich wird `take` gedeckelt, damit ein einzelner Aufruf
    // nicht das komplette Protokoll (und damit den Speicher) zieht.
    const take = clampNumber(searchParams.get('take'), 50, 1, 500)
    const skip = clampNumber(searchParams.get('skip'), 0, 0, Number.MAX_SAFE_INTEGER)
    const group = searchParams.get('group')?.trim() || ''
    const search = searchParams.get('search')?.trim() || ''

    const where: Prisma.AuditLogWhereInput = {}

    if (group === 'other') {
      where.action = { notIn: allGroupedActions() }
    } else if (group) {
      const actions = actionsForGroup(group)
      if (actions) where.action = { in: actions }
    }

    if (search) {
      const or: Prisma.AuditLogWhereInput[] = [
        { action: { contains: search } },
        { details: { contains: search } },
        { oldValue: { contains: search } },
        { newValue: { contains: search } },
        { user: { displayName: { contains: search } } },
        { agent: { firstName: { contains: search } } },
        { agent: { lastName: { contains: search } } },
        { agent: { badgeNumber: { contains: search } } },
      ]
      // "Vorname Nachname"-Suche über beide Felder
      const tokens = search.split(/\s+/).filter(Boolean)
      if (tokens.length >= 2) {
        or.push({
          agent: {
            firstName: { contains: tokens[0] },
            lastName: { contains: tokens.slice(1).join(' ') },
          },
        })
      }
      where.OR = or
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { displayName: true } },
          agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.auditLog.count({ where }),
    ])

    return success({ logs, total, take, skip })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

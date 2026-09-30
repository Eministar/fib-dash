import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { agentRecordInput, listAgentRecords } from '@/lib/agent-records'

function failure(e: unknown) {
  if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? 'Ungültige Eingabe')
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('agents:view')
    const { id } = await params
    return success(await listAgentRecords(id))
  } catch (e: unknown) {
    return failure(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('agents:write')
    const { id } = await params
    const input = agentRecordInput.parse(await req.json())
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } })
    if (!agent) return notFound('Agent')

    const label = input.kind === 'POSITIVE' ? 'Positiver' : 'Negativer'
    await prisma.$transaction([
      prisma.agentRecordEntry.create({
        data: { agentId: id, kind: input.kind, title: input.title, content: input.content, source: 'manual', authorId: user.id },
      }),
      prisma.auditLog.create({
        data: { action: 'AGENT_RECORD_CREATED', userId: user.id, agentId: id, details: `${label} Eintrag: ${input.title}` },
      }),
    ])
    return success(await listAgentRecords(id), 201)
  } catch (e: unknown) {
    return failure(e)
  }
}

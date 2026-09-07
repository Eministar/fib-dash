import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleFormTestManage } from '@/lib/module-permissions'

const responseInclude = {
  respondent: { select: { id: true, displayName: true, username: true, discordId: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  answers: {
    include: {
      question: true,
    },
    orderBy: { question: { sortOrder: 'asc' as const } },
  },
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const test = await prisma.formTest.findUnique({
      where: { id },
      select: {
        id: true,
        module: true,
        kind: true,
        title: true,
        status: true,
        anonymousResponses: true,
        questions: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      },
    })
    if (!test) return notFound('Test')

    await requireTaskModuleFormTestManage(test.module)

    const responses = await prisma.formResponse.findMany({
      where: { testId: id },
      include: responseInclude,
      orderBy: { submittedAt: 'desc' },
    })

    return success({ test, responses })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

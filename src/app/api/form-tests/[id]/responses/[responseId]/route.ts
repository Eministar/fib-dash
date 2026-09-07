import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleFormTestManage } from '@/lib/module-permissions'
import { cleanLongFormText } from '@/lib/form-tests'

const responseInclude = {
  respondent: { select: { id: true, displayName: true, username: true, discordId: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  answers: {
    include: { question: true },
    orderBy: { question: { sortOrder: 'asc' as const } },
  },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> },
) {
  try {
    const { id, responseId } = await params

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

    const response = await prisma.formResponse.findFirst({
      where: { id: responseId, testId: id },
      include: responseInclude,
    })
    if (!response) return notFound('Abgabe')

    return success({ test, response })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> },
) {
  try {
    const { id, responseId } = await params
    const body = await req.json()

    const response = await prisma.formResponse.findFirst({
      where: { id: responseId, testId: id },
      include: { test: { select: { module: true } } },
    })
    if (!response) return notFound('Abgabe')

    const user = await requireTaskModuleFormTestManage(response.test.module)

    const data: Record<string, unknown> = {
      reviewedAt: new Date(),
      reviewedById: user.id,
    }

    if ('score' in body) {
      if (body.score === null || body.score === '') {
        data.score = null
      } else {
        const score = Number(body.score)
        if (!Number.isFinite(score) || score < 0 || score > Math.max(response.maxScore, 1000)) {
          return error('Ungültige Punktzahl')
        }
        data.score = Math.round(score)
      }
    }

    if ('reviewNote' in body) {
      data.reviewNote = cleanLongFormText(body.reviewNote, 5000) || null
    }

    const updated = await prisma.formResponse.update({
      where: { id: responseId },
      data,
      include: responseInclude,
    })

    return success(updated)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> },
) {
  try {
    const { id, responseId } = await params

    const response = await prisma.formResponse.findFirst({
      where: { id: responseId, testId: id },
      include: { test: { select: { module: true } } },
    })
    if (!response) return notFound('Abgabe')

    await requireTaskModuleFormTestManage(response.test.module)

    await prisma.formResponse.delete({ where: { id: responseId } })

    return success({ id: responseId })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

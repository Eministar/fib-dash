import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleFormTestManage, requireTaskModuleView } from '@/lib/module-permissions'
import {
  cleanFormText,
  cleanLongFormText,
  cleanTimeLimitMinutes,
  isFormTestKind,
  isFormTestStatus,
  sanitizeFormQuestions,
  validateQuestionsForPublish,
} from '@/lib/form-tests'

const formTestInclude = {
  createdBy: { select: { id: true, displayName: true } },
  questions: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  _count: { select: { responses: true, questions: true } },
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const test = await prisma.formTest.findUnique({ where: { id }, include: formTestInclude })
    if (!test) return notFound('Test')

    await requireTaskModuleView(test.module)
    return success(test)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.formTest.findUnique({
      where: { id },
      include: {
        questions: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
        _count: { select: { responses: true } },
      },
    })
    if (!existing) return notFound('Test')

    await requireTaskModuleFormTestManage(existing.module)

    const updates: Record<string, unknown> = {}
    if ('title' in body) {
      const title = cleanFormText(body.title)
      if (!title) return error('Titel darf nicht leer sein')
      updates.title = title
    }
    if ('description' in body) updates.description = cleanLongFormText(body.description) || null
    if ('status' in body) {
      if (!isFormTestStatus(body.status)) return error('Ungültiger Status')
      updates.status = body.status
    }
    const nextKind = 'kind' in body
      ? (isFormTestKind(body.kind) ? body.kind : null)
      : existing.kind
    if (!nextKind) return error('Ungültiger Typ')
    if ('kind' in body) updates.kind = nextKind
    if ('timeLimitMinutes' in body || 'kind' in body) {
      updates.timeLimitMinutes = nextKind === 'TEST' ? cleanTimeLimitMinutes(body.timeLimitMinutes) : null
    }
    if ('anonymousResponses' in body || 'kind' in body) {
      updates.anonymousResponses = nextKind === 'SURVEY' ? body.anonymousResponses === true : false
    }

    const questionPayload = Array.isArray(body.questions) ? sanitizeFormQuestions(body.questions) : null
    const hasQuestionPayload = questionPayload !== null
    const questionsForValidation = questionPayload ?? existing.questions

    if (hasQuestionPayload && existing._count.responses > 0) {
      return error('Fragen können nach der ersten Abgabe nicht mehr geändert werden', 409)
    }

    if ((updates.status ?? existing.status) === 'ACTIVE') {
      const validationError = validateQuestionsForPublish(questionsForValidation)
      if (validationError) return error(validationError)
    }

    const test = await prisma.$transaction(async (tx) => {
      if (hasQuestionPayload) {
        await tx.formQuestion.deleteMany({ where: { testId: id } })
      }

      await tx.formTest.update({
        where: { id },
        data: updates,
      })

      if (hasQuestionPayload) {
        await tx.formQuestion.createMany({
          data: questionPayload.map((question) => ({
            testId: id,
            type: question.type,
            title: question.title,
            description: question.description,
            required: question.required,
            options: question.options ? question.options as Prisma.InputJsonValue : undefined,
            points: question.points,
            sortOrder: question.sortOrder,
          })),
        })
      }

      return tx.formTest.findUnique({ where: { id }, include: formTestInclude })
    })

    return success(test)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await prisma.formTest.findUnique({ where: { id } })
    if (!existing) return notFound('Test')

    await requireTaskModuleFormTestManage(existing.module)
    await prisma.formTest.delete({ where: { id } })

    return success({ message: 'Test gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

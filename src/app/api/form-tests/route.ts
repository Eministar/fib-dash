import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { success, error, unauthorized } from '@/lib/api-response'
import { isTaskModule, requireTaskModuleFormTestManage, requireTaskModuleView } from '@/lib/module-permissions'
import {
  cleanFormText,
  cleanLongFormText,
  cleanTimeLimitMinutes,
  generateFormShareToken,
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

async function createUniqueShareToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareToken = generateFormShareToken()
    const existing = await prisma.formTest.findUnique({ where: { shareToken }, select: { id: true } })
    if (!existing) return shareToken
  }
  throw new Error('Link-Token konnte nicht erstellt werden')
}

export async function GET(req: NextRequest) {
  const moduleParam = req.nextUrl.searchParams.get('module')
  const includeArchived = req.nextUrl.searchParams.get('archived') === 'true'

  try {
    if (!isTaskModule(moduleParam)) return error('Ungültiges Modul')
    await requireTaskModuleView(moduleParam)

    const tests = await prisma.formTest.findMany({
      where: {
        module: moduleParam,
        ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
      },
      include: formTestInclude,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    })

    return success(tests)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!isTaskModule(body.module)) return error('Ungültiges Modul')

    const user = await requireTaskModuleFormTestManage(body.module)
    const title = cleanFormText(body.title)
    if (!title) return error('Titel ist erforderlich')
    const kind = isFormTestKind(body.kind) ? body.kind : 'TEST'
    const timeLimitMinutes = kind === 'TEST' ? cleanTimeLimitMinutes(body.timeLimitMinutes) : null
    const anonymousResponses = kind === 'SURVEY' ? body.anonymousResponses === true : false

    let questions = sanitizeFormQuestions(body.questions)
    if (questions.length === 0) {
      questions = [{
        type: 'LONG_TEXT',
        title: 'Neue Frage',
        description: null,
        required: true,
        options: null,
        points: 0,
        sortOrder: 0,
      }]
    }

    const status = isFormTestStatus(body.status) ? body.status : 'DRAFT'
    if (status === 'ACTIVE') {
      const validationError = validateQuestionsForPublish(questions)
      if (validationError) return error(validationError)
    }

    const test = await prisma.formTest.create({
      data: {
        module: body.module,
        kind,
        title,
        description: cleanLongFormText(body.description) || null,
        status,
        timeLimitMinutes,
        anonymousResponses,
        shareToken: await createUniqueShareToken(),
        createdById: user.id,
        questions: {
          create: questions.map((question) => ({
            type: question.type,
            title: question.title,
            description: question.description,
            required: question.required,
            options: question.options ? question.options as Prisma.InputJsonValue : undefined,
            points: question.points,
            sortOrder: question.sortOrder,
          })),
        },
      },
      include: formTestInclude,
    })

    return success(test, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

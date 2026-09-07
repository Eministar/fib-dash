import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { success, error, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { buildFormSubmitterHash, calculateResponseScore, normalizeSubmittedAnswers } from '@/lib/form-tests'
import { completeFormTestSessionById, isFormTestSessionWriteConflict } from '@/lib/form-test-sessions'
import { FORM_LINK_ERRORS, resolveFormLink } from '@/lib/form-links'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireAuth()
    const { token } = await params
    const body = await req.json()

    const lookup = await resolveFormLink(token)
    if (!lookup.ok) {
      const details = FORM_LINK_ERRORS[lookup.reason]
      return error(details.message, details.status)
    }
    const test = lookup.test
    if (test.questions.length === 0) return error('Dieser Test hat keine Fragen')

    const submitterHash = buildFormSubmitterHash(test.id, user.id)
    const existingResponse = await prisma.formResponse.findFirst({
      where: {
        testId: test.id,
        OR: [
          { submitterHash },
          { respondentId: user.id },
        ],
      },
      select: { id: true },
    })
    if (existingResponse) return error('Du hast diesen Test bereits abgegeben', 409)

    const now = new Date()
    const activeSession = test.kind === 'TEST'
      ? await prisma.formTestSession.findFirst({
          where: { testId: test.id, userId: user.id, completedAt: null },
          orderBy: { startedAt: 'desc' },
          select: { id: true, expiresAt: true },
        })
      : null
    if (test.kind === 'TEST' && !activeSession) return error('Keine aktive Testsitzung gefunden', 409)
    if (activeSession?.expiresAt && activeSession.expiresAt.getTime() <= now.getTime()) {
      return error('Die Zeit für diesen Test ist abgelaufen', 403)
    }

    const { normalized, errors } = normalizeSubmittedAnswers(test.questions, body.answers)
    if (errors.length > 0) return error(errors[0])

    const anonymous = test.kind === 'SURVEY' && test.anonymousResponses
    const score = test.kind === 'TEST'
      ? calculateResponseScore(test.questions, normalized)
      : { score: null, maxScore: 0 }
    const response = await prisma.$transaction(async (tx) => (
      tx.formResponse.create({
        data: {
          testId: test.id,
          respondentId: anonymous ? null : user.id,
          respondentName: anonymous ? 'Anonym' : user.displayName,
          submitterHash,
          score: score.score,
          maxScore: score.maxScore,
          answers: {
            create: normalized.map((answer) => ({
              question: { connect: { id: answer.questionId } },
              value: answer.value as Prisma.InputJsonValue,
            })),
          },
        },
        include: {
          answers: { include: { question: true } },
        },
      })
    ))

    if (activeSession) {
      try {
        await completeFormTestSessionById(activeSession.id, now)
      } catch (e: unknown) {
        if (!isFormTestSessionWriteConflict(e)) throw e
      }
    }

    return success(response, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (isUniqueConstraintError(e)) return error('Du hast diesen Test bereits abgegeben', 409)
    return error(msg, 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { buildFormSubmitterHash, stripCorrectAnswersFromQuestion } from '@/lib/form-tests'
import {
  completeOpenFormTestSessions,
  isFormTestSessionWriteConflict,
  securityEventCount,
} from '@/lib/form-test-sessions'
import { FORM_LINK_ERRORS, closeStaleFormTestSessions, resolveFormLink } from '@/lib/form-links'

const sessionSelect = {
  id: true,
  startedAt: true,
  expiresAt: true,
  securityEvents: true,
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireAuth()
    const { token } = await params

    const lookup = await resolveFormLink(token)
    if (!lookup.ok) {
      const details = FORM_LINK_ERRORS[lookup.reason]
      return error(details.message, details.status)
    }
    const test = lookup.test

    // Verwaiste Sitzungen aufräumen, BEVOR eine neue gesucht wird — sonst
    // blockiert eine vergessene Sitzung den erneuten Einstieg in den Test.
    await closeStaleFormTestSessions(user.id)

    const submitterHash = buildFormSubmitterHash(test.id, user.id)
    const existingResponse = await prisma.formResponse.findFirst({
      where: {
        testId: test.id,
        OR: [
          { submitterHash },
          { respondentId: user.id },
        ],
      },
      select: { id: true, submittedAt: true, score: true, maxScore: true },
    })
    if (existingResponse) {
      try {
        await completeOpenFormTestSessions(test.id, user.id)
      } catch (e: unknown) {
        if (!isFormTestSessionWriteConflict(e)) throw e
      }
    }

    let session: {
      id: string
      startedAt: Date
      expiresAt: Date | null
      securityEvents: unknown
    } | null = null

    // Wichtig: Das blosse Oeffnen des Links startet den Test NICHT. Die Sitzung
    // (und damit die Uhr) entsteht erst ueber POST .../start, sonst laeuft die
    // Zeit schon, waehrend der Agent die Startseite noch liest.
    if (!existingResponse && test.kind === 'TEST') {
      const now = new Date()
      const activeSession = await prisma.formTestSession.findFirst({
        where: { testId: test.id, userId: user.id, completedAt: null },
        orderBy: { startedAt: 'desc' },
        select: sessionSelect,
      })

      if (activeSession?.expiresAt && activeSession.expiresAt.getTime() <= now.getTime()) {
        return error('Die Zeit für diesen Test ist abgelaufen', 403)
      }

      if (activeSession) {
        // Lebenszeichen setzen: solange die Seite offen ist (und dabei still
        // nachlädt), gilt die Sitzung als aktiv und wird nicht als verwaist
        // abgeräumt.
        try {
          await prisma.formTestSession.updateMany({
            where: { id: activeSession.id, completedAt: null },
            data: { lastSeenAt: now },
          })
        } catch (e: unknown) {
          if (!isFormTestSessionWriteConflict(e)) throw e
        }
        session = activeSession
      }
    }

    // Umfragen und bereits laufende Tests liefern die Fragen; ein noch nicht
    // gestarteter Test gibt nur die Eckdaten heraus, damit sich niemand die
    // Fragen ohne laufende Uhr ansehen kann.
    const started = test.kind !== 'TEST' || session !== null

    return success({
      ...test,
      started,
      questionCount: test.questions.length,
      questions: started ? test.questions.map(stripCorrectAnswersFromQuestion) : [],
      existingResponse: existingResponse
        ? {
            ...existingResponse,
            score: test.kind === 'TEST' ? null : existingResponse.score,
            maxScore: test.kind === 'TEST' ? 0 : existingResponse.maxScore,
          }
        : null,
      sessionStartedAt: session?.startedAt ?? null,
      sessionExpiresAt: session?.expiresAt ?? null,
      securityEventCount: securityEventCount(session?.securityEvents),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

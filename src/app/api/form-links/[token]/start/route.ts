import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { buildFormSubmitterHash } from '@/lib/form-tests'
import { isFormTestSessionWriteConflict, securityEventCount } from '@/lib/form-test-sessions'
import { FORM_LINK_ERRORS, closeStaleFormTestSessions, resolveFormLink } from '@/lib/form-links'

const sessionSelect = {
  id: true,
  startedAt: true,
  expiresAt: true,
  securityEvents: true,
}

/**
 * Startet die Testsitzung — bewusst als eigener Schritt. Das Öffnen des Links
 * (GET .../[token]) liefert nur die Eckdaten; erst hier beginnt die Zeit zu
 * laufen und erst danach gibt der Server die Fragen heraus.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireAuth()
    const { token } = await params

    const lookup = await resolveFormLink(token)
    if (!lookup.ok) {
      const details = FORM_LINK_ERRORS[lookup.reason]
      return error(details.message, details.status)
    }
    const test = lookup.test
    if (test.kind !== 'TEST') return error('Dieser Link muss nicht gestartet werden')
    if (test.questions.length === 0) return error('Dieser Test hat keine Fragen')

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
      select: { id: true },
    })
    if (existingResponse) return error('Du hast diesen Test bereits abgegeben', 409)

    const now = new Date()
    const activeSession = await prisma.formTestSession.findFirst({
      where: { testId: test.id, userId: user.id, completedAt: null },
      orderBy: { startedAt: 'desc' },
      select: sessionSelect,
    })

    if (activeSession?.expiresAt && activeSession.expiresAt.getTime() <= now.getTime()) {
      return error('Die Zeit für diesen Test ist abgelaufen', 403)
    }

    // Doppelklick oder ein zweiter Tab darf die Uhr nicht zurücksetzen: eine
    // laufende Sitzung wird weitergeführt statt ersetzt.
    if (activeSession) {
      try {
        await prisma.formTestSession.updateMany({
          where: { id: activeSession.id, completedAt: null },
          data: { lastSeenAt: now },
        })
      } catch (e: unknown) {
        if (!isFormTestSessionWriteConflict(e)) throw e
      }

      return success({
        startedAt: activeSession.startedAt,
        expiresAt: activeSession.expiresAt,
        securityEventCount: securityEventCount(activeSession.securityEvents),
      })
    }

    const session = await prisma.formTestSession.create({
      data: {
        testId: test.id,
        userId: user.id,
        lastSeenAt: now,
        expiresAt: test.timeLimitMinutes
          ? new Date(now.getTime() + test.timeLimitMinutes * 60 * 1000)
          : null,
      },
      select: sessionSelect,
    })

    return success({
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      securityEventCount: 0,
    }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

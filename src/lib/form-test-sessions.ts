import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isRecordChangedError } from '@/lib/prisma-errors'

const MAX_SECURITY_EVENTS = 80
const MAX_SESSION_WRITE_ATTEMPTS = 3

export function isFormTestSessionWriteConflict(error: unknown) {
  return isRecordChangedError(error)
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, 25 * attempt))
}

export async function retryFormTestSessionWrite<T>(operation: () => Promise<T>) {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_SESSION_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isFormTestSessionWriteConflict(error) || attempt === MAX_SESSION_WRITE_ATTEMPTS) break
      await waitForRetry(attempt)
    }
  }

  throw lastError
}

export function readSecurityEvents(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .slice(-MAX_SECURITY_EVENTS + 1)
    : []
}

export function securityEventCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

export async function completeOpenFormTestSessions(testId: string, userId: string, completedAt = new Date()) {
  return retryFormTestSessionWrite(() => prisma.formTestSession.updateMany({
    where: { testId, userId, completedAt: null },
    data: { completedAt, lastSeenAt: completedAt },
  }))
}

export async function completeFormTestSessionById(sessionId: string, completedAt = new Date()) {
  return retryFormTestSessionWrite(() => prisma.formTestSession.updateMany({
    where: { id: sessionId, completedAt: null },
    data: { completedAt, lastSeenAt: completedAt },
  }))
}

export async function recordFormTestSessionSecurityEvent(sessionId: string, type: string, recordedAt = new Date()) {
  return retryFormTestSessionWrite(async () => {
    const session = await prisma.formTestSession.findUnique({
      where: { id: sessionId },
      select: { completedAt: true, expiresAt: true, securityEvents: true },
    })

    if (!session) return { recorded: false, count: 0 }

    if (!session.completedAt && (!session.expiresAt || session.expiresAt.getTime() > recordedAt.getTime())) {
      const events = [
        ...readSecurityEvents(session.securityEvents),
        { type, at: recordedAt.toISOString() },
      ]
      const updated = await prisma.formTestSession.updateMany({
        where: {
          id: sessionId,
          completedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: recordedAt } },
          ],
        },
        data: {
          lastSeenAt: recordedAt,
          securityEvents: events as Prisma.InputJsonValue,
        },
      })

      return { recorded: updated.count > 0, count: events.length }
    }

    return { recorded: false, count: 0 }
  })
}

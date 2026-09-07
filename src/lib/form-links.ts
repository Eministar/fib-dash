import { prisma } from '@/lib/prisma'
import { normalizeLinkToken } from '@/lib/link-tokens'

/**
 * Eine Test-Sitzung ohne Zeitlimit lief bisher unbegrenzt weiter. Wer den Link
 * einmal geöffnet und den Tab geschlossen hat, blieb dadurch dauerhaft im
 * „Du hast gerade einen Test laufen“-Zustand hängen und kam weder in den Test
 * noch ins restliche Dashboard. Sitzungen ohne Lebenszeichen gelten deshalb
 * nach dieser Zeitspanne als abgebrochen.
 */
export const STALE_FORM_SESSION_MS = Number.parseInt(
  process.env.FIB_FORM_SESSION_STALE_MS || `${3 * 60 * 60 * 1000}`,
  10,
) || 3 * 60 * 60 * 1000

export type FormLinkLookup =
  | { ok: true; test: FormTestWithQuestions }
  | { ok: false; reason: 'not-found' | 'draft' | 'archived' }

type FormTestWithQuestions = NonNullable<Awaited<ReturnType<typeof findFormTestByToken>>>

/**
 * Sucht den Test zum Link-Token.
 *
 * Zwei Fallstricke werden hier bewusst abgefangen:
 *
 * 1. Der Token aus der URL kann Reste enthalten (siehe {@link normalizeLinkToken}).
 * 2. MySQL vergleicht Strings mit der Standard-Kollation case-INsensitiv.
 *    `findUnique` könnte also einen Token liefern, der sich nur in der
 *    Groß-/Kleinschreibung unterscheidet. Deshalb wird exakt nachgeprüft.
 */
export async function findFormTestByToken(rawToken: string) {
  const token = normalizeLinkToken(rawToken)
  if (!token) return null

  const test = await prisma.formTest.findUnique({
    where: { shareToken: token },
    include: {
      questions: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
    },
  })
  if (!test) return null
  if (test.shareToken !== token) return null

  return test
}

/**
 * Wie {@link findFormTestByToken}, unterscheidet aber, WARUM ein Test nicht
 * geöffnet werden kann. Vorher liefen „Link existiert nicht“ und „Test ist noch
 * ein Entwurf“ auf dieselbe unbrauchbare Meldung hinaus.
 */
export async function resolveFormLink(rawToken: string): Promise<FormLinkLookup> {
  const test = await findFormTestByToken(rawToken)
  if (!test) return { ok: false, reason: 'not-found' }
  if (test.status === 'DRAFT') return { ok: false, reason: 'draft' }
  if (test.status === 'ARCHIVED') return { ok: false, reason: 'archived' }
  return { ok: true, test }
}

export const FORM_LINK_ERRORS = {
  'not-found': {
    status: 404,
    message:
      'Dieser Testlink ist ungültig. Bitte prüfe, ob der Link vollständig kopiert wurde, und fordere ihn sonst neu an.',
  },
  draft: {
    status: 403,
    message: 'Dieser Test ist noch nicht freigegeben. Bitte warte, bis er veröffentlicht wurde.',
  },
  archived: {
    status: 403,
    message: 'Dieser Test wurde archiviert und kann nicht mehr bearbeitet werden.',
  },
} as const

/** Zeitpunkt, ab dem eine Sitzung ohne Lebenszeichen als abgebrochen gilt. */
export function staleSessionCutoff(now = new Date()) {
  return new Date(now.getTime() - STALE_FORM_SESSION_MS)
}

/**
 * Bedingung für „diese Sitzung läuft wirklich noch“: nicht abgeschlossen, nicht
 * abgelaufen und mit einem Lebenszeichen innerhalb des Stale-Fensters.
 */
export function activeSessionWhere(now = new Date()) {
  return {
    completedAt: null,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { lastSeenAt: { gt: staleSessionCutoff(now) } },
    ],
  }
}

/**
 * Schließt verwaiste Sitzungen ab. Wird beim Öffnen eines Tests und beim Prüfen
 * der aktiven Sitzung aufgerufen, damit sich niemand dauerhaft aussperrt.
 */
export async function closeStaleFormTestSessions(userId: string, now = new Date()) {
  return prisma.formTestSession.updateMany({
    where: {
      userId,
      completedAt: null,
      OR: [
        { expiresAt: { lte: now } },
        { lastSeenAt: { lte: staleSessionCutoff(now) } },
      ],
    },
    data: { completedAt: now },
  })
}

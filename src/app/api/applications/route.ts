import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import {
  APPLICATION_DEFAULT_STATUS_TEXT,
  normalizeApplicationAnswers,
  pickApplicantName,
} from '@/lib/job-applications'
import { getApplicationFormConfig } from '@/lib/job-application-settings'
import { applyApplicantIdentity } from '@/lib/application-identity'

export async function GET() {
  try {
    await requirePermission('hr:view')

    const applications = await prisma.jobApplication.findMany({
      include: {
        applicant: { select: { id: true, displayName: true, username: true, discordId: true } },
        reviewedBy: { select: { id: true, displayName: true } },
        answers: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    })

    return success(applications)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.discordId) return error('Für eine Bewerbung ist ein Discord-Konto erforderlich', 403)

    const body = await req.json()
    const existing = await prisma.jobApplication.findUnique({
      where: { applicantId: user.id },
      select: { id: true },
    })
    if (existing) return error('Du hast bereits eine Bewerbung eingereicht', 409)

    const formConfig = await getApplicationFormConfig()
    const { normalized, errors } = normalizeApplicationAnswers(
      body.answers,
      formConfig.questions,
      { discordId: user.discordId },
    )
    if (errors.length > 0) return error(errors[0])

    const storedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        discordUsername: true,
        discordGlobalName: true,
        discordAvatar: true,
      },
    })

    const application = await prisma.jobApplication.create({
      data: {
        applicantId: user.id,
        discordId: user.discordId,
        discordUsername: storedUser?.discordUsername ?? null,
        discordGlobalName: storedUser?.discordGlobalName ?? null,
        discordAvatar: storedUser?.discordAvatar ?? null,
        applicantDisplayName: user.displayName,
        statusText: APPLICATION_DEFAULT_STATUS_TEXT,
        answers: {
          create: normalized.map((answer) => ({
            questionId: answer.questionId,
            questionTitle: answer.questionTitle,
            questionType: answer.questionType,
            value: answer.value as Prisma.InputJsonValue,
            sortOrder: answer.sortOrder,
          })),
        },
      },
      include: {
        applicant: { select: { id: true, displayName: true, username: true, discordId: true } },
        reviewedBy: { select: { id: true, displayName: true } },
        answers: { orderBy: { sortOrder: 'asc' } },
      },
    })

    // Ab hier trägt der Bewerber sein Aktenzeichen: "BW-0001 | Vorname Nachname"
    // — in der Bewerbung, im Dashboard-Anzeigenamen und als Discord-Nickname.
    const { caseNumber, displayName } = await applyApplicantIdentity({
      applicationId: application.id,
      userId: user.id,
      discordId: user.discordId,
      applicantName: pickApplicantName(normalized) || user.displayName,
    })

    return success({
      ...application,
      caseNumber,
      applicantDisplayName: displayName,
      applicant: { ...application.applicant, displayName },
    }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (isUniqueConstraintError(e)) return error('Du hast bereits eine Bewerbung eingereicht', 409)
    return error(msg, 500)
  }
}

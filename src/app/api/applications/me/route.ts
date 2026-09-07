import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getApplicationFormConfig } from '@/lib/job-application-settings'

const applicationSelect = {
  id: true,
  caseNumber: true,
  status: true,
  statusText: true,
  submittedAt: true,
  updatedAt: true,
  reviewedAt: true,
  answers: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      questionId: true,
      questionTitle: true,
      questionType: true,
      value: true,
      sortOrder: true,
    },
  },
}

export async function GET() {
  try {
    const user = await requireAuth()
    if (!user.discordId) return error('Für das Bewerberportal ist ein Discord-Konto erforderlich', 403)
    const formConfig = await getApplicationFormConfig()

    const application = await prisma.jobApplication.findUnique({
      where: { applicantId: user.id },
      select: applicationSelect,
    })

    return success({
      user,
      formTitle: formConfig.title,
      questions: formConfig.questions,
      application,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

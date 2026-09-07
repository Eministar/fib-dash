import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import {
  JOB_APPLICATION_STATUS_META,
  cleanApplicationLongText,
  cleanApplicationStatusText,
  isJobApplicationStatus,
  type JobApplicationStatusValue,
} from '@/lib/job-applications'

const applicationInclude = {
  applicant: { select: { id: true, displayName: true, username: true, discordId: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  answers: { orderBy: { sortOrder: 'asc' as const } },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('hr:view')
    const { id } = await params

    const application = await prisma.jobApplication.findUnique({
      where: { id },
      include: applicationInclude,
    })
    if (!application) return notFound('Bewerbung')

    return success(application)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const reviewer = await requirePermission('hr:manage')
    const { id } = await params
    const body = await req.json() as Record<string, unknown>

    const existing = await prisma.jobApplication.findUnique({
      where: { id },
      select: { id: true, status: true, statusText: true },
    })
    if (!existing) return notFound('Bewerbung')

    const currentStatus = existing.status as JobApplicationStatusValue
    const nextStatus: JobApplicationStatusValue | null = 'status' in body
      ? (isJobApplicationStatus(body.status) ? body.status : null)
      : currentStatus
    if (!nextStatus) return error('Ungültiger Bewerbungsstatus')

    const statusText = 'statusText' in body || nextStatus !== currentStatus
      ? cleanApplicationStatusText(body.statusText, JOB_APPLICATION_STATUS_META[nextStatus].defaultText)
      : existing.statusText

    const application = await prisma.jobApplication.update({
      where: { id },
      data: {
        status: nextStatus,
        statusText,
        internalNote: 'internalNote' in body ? cleanApplicationLongText(body.internalNote, 5000) || null : undefined,
        reviewedAt: new Date(),
        reviewedById: reviewer.id,
      },
      include: applicationInclude,
    })

    return success(application)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

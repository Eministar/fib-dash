import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { templateInputSchema } from '@/lib/agreements'
import { deleteTemplate, updateTemplate } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:manage')
    return success(await updateTemplate((await params).id, templateInputSchema.parse(await req.json())))
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requirePermission('agreements:manage')
    await deleteTemplate((await params).id)
    return success(null)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

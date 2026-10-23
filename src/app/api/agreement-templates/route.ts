import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { templateInputSchema } from '@/lib/contracts/agreements'
import { createTemplate, listTemplates } from '@/lib/contracts/agreement-service'
import { agreementErrorResponse } from '@/lib/contracts/agreement-http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requirePermission('agreements:view')
    return success(await listTemplates())
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('agreements:manage')
    return success(await createTemplate(templateInputSchema.parse(await req.json()), user.id), 201)
  } catch (cause) {
    return agreementErrorResponse(cause)
  }
}

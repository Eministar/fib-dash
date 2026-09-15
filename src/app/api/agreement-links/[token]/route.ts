import { NextRequest } from 'next/server'
import { success, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { publicShareHeaders } from '@/lib/record-shares'
import { linkActionSchema } from '@/lib/agreements'
import { declineParty, loadPartyByToken, serializeLink, signParty } from '@/lib/agreement-service'
import { agreementErrorResponse } from '@/lib/agreement-http'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || req.headers.get('x-real-ip') || '').slice(0, 64) || null
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const party = await loadPartyByToken((await params).token)
    return publicShareHeaders(party ? success(serializeLink(party)) : notFound('Link'))
  } catch (cause) {
    return publicShareHeaders(agreementErrorResponse(cause))
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const party = await loadPartyByToken((await params).token)
    if (!party) return publicShareHeaders(notFound('Link'))
    const action = linkActionSchema.parse(await req.json())

    if (action.action === 'sign') {
      await signParty(party.token, { name: action.name, ip: clientIp(req), userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null })
      await createAuditLog({ action: 'AGREEMENT_SIGNED', userId: null, newValue: action.name, details: `${party.name}: ${party.agreement.title}` })
    } else {
      await declineParty(party.token, action.reason || null)
      await createAuditLog({ action: 'AGREEMENT_DECLINED', userId: null, newValue: party.name, details: `${party.agreement.title}${action.reason ? `: ${action.reason}` : ''}` })
    }

    const updated = await loadPartyByToken(party.token)
    return publicShareHeaders(updated ? success(serializeLink(updated)) : notFound('Link'))
  } catch (cause) {
    return publicShareHeaders(agreementErrorResponse(cause))
  }
}

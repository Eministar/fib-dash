import { success } from '@/lib/api-response'
import { resolveShare, shareError, publicShareHeaders } from '@/lib/investigations/record-shares'
import { expandSharedItems, sharedHeading } from '@/lib/investigations/shared-records-public'
import { raidReference } from '@/lib/investigations/raid-request'
import { readRaidRequest } from '@/lib/investigations/raid-request-schema'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const share = await resolveShare((await params).token)
    const items = (await Promise.all((await expandSharedItems(share.items)).map(async item => { const title = await sharedHeading(item); return title ? { kind: item.kind, recordId: item.recordId, title } : null }))).filter(item => item !== null)
    const raidRequest = readRaidRequest(share.raidRequest)
    return publicShareHeaders(success({
      title: share.title,
      expiresAt: share.expiresAt,
      items,
      raid: raidRequest ? { request: raidRequest, reference: raidReference(share.id, share.createdAt), createdAt: share.createdAt } : null,
    }))
  } catch (cause) { return publicShareHeaders(shareError(cause)) }
}

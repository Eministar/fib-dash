import { success } from '@/lib/api-response'
import { resolveShare, shareError, publicShareHeaders } from '@/lib/record-shares'
import { sharedHeading } from '@/lib/shared-records-public'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const share = await resolveShare((await params).token)
    const items = (await Promise.all(share.items.map(async item => { const title = await sharedHeading(item); return title ? { kind: item.kind, recordId: item.recordId, title } : null }))).filter(item => item !== null)
    return publicShareHeaders(success({ title: share.title, expiresAt: share.expiresAt, items }))
  } catch (cause) { return publicShareHeaders(shareError(cause)) }
}

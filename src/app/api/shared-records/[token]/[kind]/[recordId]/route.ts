import { success } from '@/lib/api-response'
import { resolveShare, shareError, publicShareHeaders } from '@/lib/record-shares'
import { publicRecord, requireSharedSelection } from '@/lib/shared-records-public'
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; kind: string; recordId: string }> }) {
  try {
    const { token, kind, recordId } = await params
    const share = await resolveShare(token)
    const item = requireSharedSelection(share.items, kind, recordId)
    return publicShareHeaders(success(await publicRecord(item)))
  } catch (cause) { return publicShareHeaders(shareError(cause)) }
}

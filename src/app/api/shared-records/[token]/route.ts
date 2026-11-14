import { success } from '@/lib/api-response'
import { resolveShare, shareError, publicShareHeaders } from '@/lib/investigations/record-shares'
import { expandSharedItems, sharedHeading } from '@/lib/investigations/shared-records-public'
import { raidReference } from '@/lib/investigations/raid-request'
import { readRaidRequest } from '@/lib/investigations/raid-request-schema'
import { mergeCharges, readCharges } from '@/lib/investigations/charges'
import { chargeTexts } from '@/lib/laws/charges-server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const share = await resolveShare((await params).token)
    const expanded = await expandSharedItems(share.items)
    const items = (await Promise.all(expanded.map(async item => { const title = await sharedHeading(item); return title ? { kind: item.kind, recordId: item.recordId, title } : null }))).filter(item => item !== null)
    const raidRequest = readRaidRequest(share.raidRequest)
    // Beim Antrag: Gesetzestexte aller Straftatbestände der freigegebenen Einsatzakten als Anlage.
    const caseIds = expanded.filter(item => item.kind === 'CASE').map(item => item.recordId)
    const laws = raidRequest && caseIds.length
      ? await chargeTexts(mergeCharges(...(await prisma.investigation.findMany({ where: { id: { in: caseIds } }, select: { charges: true } })).map(row => readCharges(row.charges))))
      : []
    return publicShareHeaders(success({
      title: share.title,
      expiresAt: share.expiresAt,
      items,
      raid: raidRequest ? { request: raidRequest, reference: raidReference(share.id, share.createdAt), createdAt: share.createdAt, laws } : null,
    }))
  } catch (cause) { return publicShareHeaders(shareError(cause)) }
}

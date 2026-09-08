import { prisma } from '@/lib/prisma'
import { resolveShare, shareError, publicShareHeaders, ShareError } from '@/lib/record-shares'
import { sharedHeading, sharedPhoto, requireSharedSelection } from '@/lib/shared-records-public'
import { clipFileResponse } from '@/lib/clips'
import { investigationPhotoResponse } from '@/lib/investigation-photos'
export async function GET(req: Request, { params }: { params: Promise<{ token: string; kind: string; recordId: string }> }) {
  try {
    const { token, kind, recordId } = await params
    const share = await resolveShare(token)
    const item = requireSharedSelection(share.items, kind, recordId)
    if (!await sharedHeading(item)) throw new ShareError('Datei nicht freigegeben', 404)
    if (kind === 'CLIP') {
      const clip = await prisma.bodycamClip.findUniqueOrThrow({ where: { id: recordId }, select: { filename: true, mimeType: true } })
      return publicShareHeaders(await clipFileResponse(clip.filename, clip.mimeType, req.headers.get('range')))
    }
    const photo = await sharedPhoto(item)
    if (!photo) throw new ShareError('Kein freigegebenes Bild', 404)
    return publicShareHeaders(await investigationPhotoResponse(photo.filename, photo.mimeType))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return publicShareHeaders(shareError(new ShareError('Datei nicht verfügbar', 404)))
    return publicShareHeaders(shareError(cause))
  }
}

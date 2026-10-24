import { getCurrentUser } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { desktopDownloadPath, readLatestDesktopRelease } from '@/lib/desktop/desktop-releases'

export const dynamic = 'force-dynamic'

/** Aktuelle Version der Desktop-App für die Download-Seite. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const release = await readLatestDesktopRelease()
  return success(release && {
    version: release.version,
    pubDate: release.pubDate,
    size: release.size,
    downloadUrl: desktopDownloadPath(release),
  })
}

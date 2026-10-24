import type { NextRequest } from 'next/server'
import { resolveBaseUrl } from '@/lib/site'
import { desktopDownloadPath, readLatestDesktopRelease } from '@/lib/desktop/desktop-releases'

export const dynamic = 'force-dynamic'

/**
 * Update-Manifest im Format des Tauri-Updaters. Bewusst ohne Anmeldung: Die
 * Desktop-App fragt es beim Start ab. Echtheit sichert die Signatur, die die
 * App gegen ihren eingebauten Public Key prüft.
 */
export async function GET(req: NextRequest) {
  const release = await readLatestDesktopRelease()
  // 204 heißt für den Updater „kein Update verfügbar".
  if (!release) return new Response(null, { status: 204 })

  return Response.json({
    version: release.version,
    notes: release.notes ?? '',
    pub_date: release.pubDate,
    platforms: {
      'windows-x86_64': {
        signature: release.signature,
        url: `${resolveBaseUrl(req)}${desktopDownloadPath(release)}`,
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

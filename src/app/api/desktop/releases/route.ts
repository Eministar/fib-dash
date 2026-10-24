import { timingSafeEqual } from 'node:crypto'
import { error, success } from '@/lib/api-response'
import { publishDesktopRelease } from '@/lib/desktop/desktop-releases'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

const MAX_INSTALLER_BYTES = 200 * 1024 * 1024

function authorized(req: Request) {
  const expected = process.env.DESKTOP_RELEASE_TOKEN?.trim()
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Nimmt ein neues Release der Desktop-App entgegen – aufgerufen vom Workflow
 * `.github/workflows/desktop.yml`, geschützt über DESKTOP_RELEASE_TOKEN.
 * Felder (multipart): `installer` (Datei), `version`, `signature`, `notes`.
 */
export async function POST(req: Request) {
  try {
    if (!process.env.DESKTOP_RELEASE_TOKEN?.trim()) {
      return error('DESKTOP_RELEASE_TOKEN ist auf dem Server nicht gesetzt', 503)
    }
    if (!authorized(req)) return error('Nicht autorisiert', 401)

    const form = await req.formData()
    const installer = form.get('installer')
    const version = String(form.get('version') ?? '')
    const signature = String(form.get('signature') ?? '').trim()
    const notes = String(form.get('notes') ?? '').slice(0, 2000) || undefined

    if (!/^\d+\.\d+\.\d+$/.test(version)) return error('Ungültige Version')
    if (!signature) return error('Signatur fehlt')
    if (!(installer instanceof File) || installer.size === 0) return error('Installer fehlt')
    if (installer.size > MAX_INSTALLER_BYTES) return error('Installer ist zu groß', 413)

    const bytes = Buffer.from(await installer.arrayBuffer())
    // Windows-Programme beginnen mit „MZ“ – alles andere ist kein Installer.
    if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) return error('Datei ist kein Windows-Installer', 422)

    const release = await publishDesktopRelease({ version, signature, notes, installer: bytes })
    return success({ version: release.version, file: release.file }, 201)
  } catch (cause) {
    return routeError(cause)
  }
}

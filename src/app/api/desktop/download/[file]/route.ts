import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { notFound } from '@/lib/api-response'
import { isDesktopInstallerName, resolveDesktopInstaller } from '@/lib/desktop/desktop-releases'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ file: string }> }

/** Liefert den Installer aus – ohne Anmeldung, weil der Updater der App ihn lädt. */
export async function GET(_req: Request, { params }: Context) {
  const { file } = await params
  if (!isDesktopInstallerName(file)) return notFound('Datei')

  const filePath = resolveDesktopInstaller(file)
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return notFound('Datei')
  }

  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/vnd.microsoft.portable-executable',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${file}"`,
      // Dateinamen enthalten die Version – ein Installer ändert sich nie.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

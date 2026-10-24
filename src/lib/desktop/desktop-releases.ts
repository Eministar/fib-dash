import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/**
 * Ablage der Desktop-App-Releases. Der Workflow `.github/workflows/desktop.yml`
 * lädt dorthin den Installer und danach `release.json` hoch.
 */
export function desktopReleaseDir() {
  const configured = process.env.DESKTOP_RELEASE_DIR?.trim()
  if (configured) {
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured)
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'desktop-releases')
}

const releaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  file: z.string(),
  signature: z.string().min(1),
  pubDate: z.string(),
  notes: z.string().optional(),
})

export type DesktopRelease = z.infer<typeof releaseSchema> & { size: number }

export function isDesktopInstallerName(name: string) {
  return /^FIB-Desktop-Setup-\d+\.\d+\.\d+\.exe$/.test(name)
}

export function resolveDesktopInstaller(name: string) {
  if (!isDesktopInstallerName(name)) throw new Error('Dateiname ist ungültig')
  return path.join(/*turbopackIgnore: true*/ desktopReleaseDir(), name)
}

/** Aktuelles Release – `null`, solange noch keins hochgeladen wurde. */
export async function readLatestDesktopRelease(): Promise<DesktopRelease | null> {
  let raw: string
  try {
    raw = await readFile(path.join(/*turbopackIgnore: true*/ desktopReleaseDir(), 'release.json'), 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw cause
  }
  const release = releaseSchema.parse(JSON.parse(raw))
  const { size } = await stat(resolveDesktopInstaller(release.file))
  return { ...release, size }
}

export function desktopDownloadPath(release: Pick<DesktopRelease, 'file'>) {
  return `/api/desktop/download/${encodeURIComponent(release.file)}`
}

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/**
 * Ablage der Desktop-App-Releases. Der Workflow `.github/workflows/desktop.yml`
 * schickt den Installer an `POST /api/desktop/releases`, das ihn hier ablegt.
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

const KEEP_INSTALLERS = 3

/**
 * Legt ein neues Release ab: erst den Installer, dann `release.json`. Beides
 * über eine temporäre Datei + rename, damit Apps nie eine halbe Datei sehen.
 */
export async function publishDesktopRelease(input: { version: string; signature: string; notes?: string; installer: Buffer }) {
  const dir = desktopReleaseDir()
  await mkdir(dir, { recursive: true })

  const file = `FIB-Desktop-Setup-${input.version}.exe`
  const target = resolveDesktopInstaller(file)
  await writeFile(`${target}.tmp`, input.installer)
  await rename(`${target}.tmp`, target)

  const release = releaseSchema.parse({
    version: input.version,
    file,
    signature: input.signature,
    pubDate: new Date().toISOString(),
    notes: input.notes,
  })
  const manifest = path.join(/*turbopackIgnore: true*/ dir, 'release.json')
  await writeFile(`${manifest}.tmp`, JSON.stringify(release, null, 2))
  await rename(`${manifest}.tmp`, manifest)

  // Nur die letzten Installer behalten.
  const installers = (await readdir(dir)).filter(isDesktopInstallerName)
  const withTimes = await Promise.all(
    installers.map(async (name) => ({ name, time: (await stat(resolveDesktopInstaller(name))).mtimeMs })),
  )
  withTimes.sort((a, b) => b.time - a.time)
  await Promise.all(withTimes.slice(KEEP_INSTALLERS).map(({ name }) => rm(resolveDesktopInstaller(name), { force: true })))

  return release
}

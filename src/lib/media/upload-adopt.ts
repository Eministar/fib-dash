import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

/**
 * Übernimmt eine fertig geprüfte Datei aus der Zwischenablage von
 * `/api/uploads` in ihr endgültiges Verzeichnis.
 *
 * Zwischenablage und Ziel liegen beide unter `uploadDir()`, ein `rename`
 * genügt also normalerweise. Über Dateisystemgrenzen hinweg — etwa wenn
 * `CLIP_DIR` auf ein eigenes Volume zeigt — scheitert es mit `EXDEV`; dann
 * wird kopiert und die Quelle entfernt.
 */
export async function adoptUploadedFile(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
    await copyFile(source, target)
    await unlink(source).catch(() => {})
  }
  return path.basename(target)
}

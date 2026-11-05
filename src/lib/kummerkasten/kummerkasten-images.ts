import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { uploadDir } from '../media/uploads'

/** Bilder liegen unter uploads/kummerkasten; Dateinamen sind zufällig (keine Rückschlüsse). */
export function kummerkastenImagePath(filename: string) {
  if (!/^[a-f0-9-]{36}\.(jpg|png)$/.test(filename)) throw new Error('Ungültige Bilddatei')
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'kummerkasten', filename)
}

export async function storeKummerkastenImage(bytes: Buffer, extension: 'jpg' | 'png') {
  const filename = `${randomUUID()}.${extension}`
  const target = kummerkastenImagePath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes, { flag: 'wx' })
  return filename
}

export function readKummerkastenImage(filename: string) {
  return readFile(kummerkastenImagePath(filename))
}

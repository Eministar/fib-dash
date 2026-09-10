import { prisma } from '@/lib/prisma'
import { DEFAULT_FILE_UPLOAD_MAX_BYTES } from '@/lib/file-upload-types'

export async function getBadgePrefix(): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'badgePrefix' } })
  return row?.value?.trim() || ''
}

export async function getAllowDuplicateBadgeNumbers(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'allowDuplicateBadgeNumbers' } })
  return row?.value === 'true'
}

export async function getOrgName(): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'orgName' } })
  return row?.value?.trim() || 'FIB'
}

/**
 * Liefert das Token-Limit pro Benutzer.
 * - `'unlimited'` oder `null` / `0` / leer → unbegrenzt
 * - positive Ganzzahl → diese Anzahl
 *
 * Standard: 10.
 */
export async function getApiTokensMaxPerUser(): Promise<number | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'apiTokensMaxPerUser' } })
  if (!row) return 10
  const v = row.value?.trim()
  if (!v) return 10
  if (v.toLowerCase() === 'unlimited' || v === '0' || v === '-1') return null
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Größenlimit der Datei-Upload-API in Bytes. Ohne Einstellung 100 MB;
 * ein unbrauchbarer Wert fällt ebenfalls auf den Standard zurück, damit
 * ein Tippfehler die API nicht stilllegt.
 */
export async function getFileUploadMaxBytes(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'fileUploadMaxBytes' } })
  const parsed = Number.parseInt(row?.value?.trim() ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FILE_UPLOAD_MAX_BYTES
}

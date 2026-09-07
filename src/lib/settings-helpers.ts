import { prisma } from '@/lib/prisma'

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

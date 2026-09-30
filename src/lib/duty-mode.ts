import { prisma } from '@/lib/prisma'

/**
 * `api`: Dienstzeit kommt automatisch aus der Player-Online-API.
 * `manual`: Agents stempeln selbst im Dashboard oder über Discord ein und aus.
 */
export type DutyMode = 'api' | 'manual'

export const DUTY_MODE_SETTING_KEY = 'duty.mode'
/** Nach so langer Dienstzeit (bzw. seit der letzten Bestätigung) fragt der Bot nach, ob man noch im Dienst ist. */
export const DUTY_ACTIVITY_CHECK_AFTER_MS = 30 * 60_000
/** Ohne Antwort in dieser Zeit wird automatisch ausgestempelt. */
export const DUTY_ACTIVITY_RESPONSE_MS = 60_000

export async function getDutyMode(): Promise<DutyMode> {
  const row = await prisma.systemSetting.findUnique({ where: { key: DUTY_MODE_SETTING_KEY } })
  return row?.value === 'manual' ? 'manual' : 'api'
}

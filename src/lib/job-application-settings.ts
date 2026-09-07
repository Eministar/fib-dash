import { prisma } from '@/lib/prisma'
import {
  APPLICATION_FORM_SETTINGS_KEY,
  DEFAULT_APPLICATION_FORM_CONFIG,
  type ApplicationFormConfig,
  normalizeApplicationFormConfig,
} from '@/lib/job-applications'

function readSettingValue(value: unknown) {
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export async function getApplicationFormConfig(): Promise<ApplicationFormConfig> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: APPLICATION_FORM_SETTINGS_KEY },
    select: { value: true },
  })

  if (!setting) return DEFAULT_APPLICATION_FORM_CONFIG

  return normalizeApplicationFormConfig(readSettingValue(setting.value))
}

export async function saveApplicationFormConfig(rawConfig: unknown) {
  const config = normalizeApplicationFormConfig(rawConfig)

  await prisma.systemSetting.upsert({
    where: { key: APPLICATION_FORM_SETTINGS_KEY },
    update: { value: JSON.stringify(config) },
    create: {
      key: APPLICATION_FORM_SETTINGS_KEY,
      value: JSON.stringify(config),
    },
  })

  return config
}

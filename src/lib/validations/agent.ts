import { z } from 'zod'

export const AGENT_FLAG_VALUES = ['RED', 'ORANGE', 'YELLOW', 'BLUE'] as const
export const AGENT_UNIT_VALUES = ['HR_LEITUNG', 'HR_TRAINEE', 'HR_OFFICER', 'ACADEMY', 'SRU', 'AIR_SUPPORT'] as const

export type AgentFlagValue = (typeof AGENT_FLAG_VALUES)[number]
export type AgentUnitValue = (typeof AGENT_UNIT_VALUES)[number]

/** Discord Snowflake-Ziffernkette (ohne Bot; nur Speicher auf dem Agent). */
export const discordIdSchema = z
  .union([z.string(), z.literal(''), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    const s = String(v).trim()
    return s === '' ? null : s
  })
  .refine((v) => v === undefined || v === null || /^\d{17,22}$/.test(v), {
    message: 'Discord-ID: 17–22 Ziffern (Snowflake)',
  })

export const createAgentSchema = z.object({
  badgeNumber: z.string().trim().optional().nullable(),
  firstName: z.string().min(1, 'Vorname ist erforderlich'),
  lastName: z.string().min(1, 'Nachname ist erforderlich'),
  rankId: z.string().min(1, 'Rang ist erforderlich'),
  discordId: discordIdSchema,
  notes: z.string().optional().nullable(),
  hireDate: z.string().optional(),
  status: z.enum(['ACTIVE', 'AWAY', 'INACTIVE', 'TERMINATED']).optional(),
  unit: z.string().trim().min(1).nullable().optional(),
  units: z.array(z.string().trim().min(1)).nullable().optional(),
  flag: z.enum(AGENT_FLAG_VALUES).nullable().optional(),
  /** Bewerbung, aus der dieser Agent hervorgeht (wird verknüpft). */
  applicationId: z.string().trim().min(1).nullable().optional(),
  /** Vorlage für den Vertrag; leer = Standardvorlage. */
  contractTemplateId: z.string().trim().min(1).nullable().optional(),
})

export const updateAgentSchema = createAgentSchema.partial()

export const updateTrainingsSchema = z.object({
  trainings: z.array(z.object({
    trainingId: z.string(),
    completed: z.boolean(),
  })).max(200).refine(
    (trainings) => new Set(trainings.map((training) => training.trainingId)).size === trainings.length,
    { message: 'Eine Ausbildung darf nur einmal übermittelt werden' },
  ),
  overrideTrainingIds: z.array(z.string()).optional().default([]),
})

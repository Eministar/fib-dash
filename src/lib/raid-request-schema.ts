import { z } from 'zod'
import { RAID_MEASURES, RAID_URGENCY, type RaidMeasure, type RaidRequest, type RaidUrgency } from '@/lib/raid-request'

const measureKeys = Object.keys(RAID_MEASURES) as [RaidMeasure, ...RaidMeasure[]]

const text = (max: number) => z.string().trim().max(max)

export const raidRequestSchema = z.object({
  recipient: text(200).min(1, 'Bitte den Empfänger angeben'),
  target: text(200).min(1, 'Bitte das Zielobjekt angeben'),
  address: text(300).default(''),
  suspects: text(2000).default(''),
  offenses: text(2000).min(1, 'Bitte die Tatvorwürfe angeben'),
  facts: text(12000).min(1, 'Bitte den Sachverhalt schildern'),
  measures: z.array(z.enum(measureKeys)).min(1, 'Mindestens eine Maßnahme wählen').max(measureKeys.length),
  urgency: z.enum(Object.keys(RAID_URGENCY) as [RaidUrgency, ...RaidUrgency[]]).default('REGULAR'),
  window: text(200).default(''),
  applicantName: text(200).min(1, 'Bitte den Antragsteller angeben'),
  applicantRank: text(120).default(''),
  applicantBadge: text(60).default(''),
}).strict() satisfies z.ZodType<RaidRequest>

/** Gespeicherte Daten lesen; unbrauchbare oder alte Formen ergeben `null`. */
export function readRaidRequest(value: unknown): RaidRequest | null {
  const result = raidRequestSchema.safeParse(value)
  return result.success ? result.data : null
}


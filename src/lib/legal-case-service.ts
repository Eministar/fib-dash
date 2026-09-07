import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { CONTRACT_PLACE } from '@/lib/contracts'
import { stripTerminatedBadgeNumber } from '@/lib/badge-number'
import { formatFineAmount, penalGradeLabel, sanctionMeasureLabel } from '@/lib/sanction-catalog'
import { formatSequenceNumber, nextSequenceNumber, parseSequenceNumber } from '@/lib/sequence-numbers'
import {
  LEGAL_CASE_PREFIX,
  readLegalCaseSanctions,
  type LegalCaseKindValue,
} from '@/lib/legal-cases'

export const legalCaseSelect = {
  id: true,
  caseNumber: true,
  token: true,
  kind: true,
  status: true,
  title: true,
  agentId: true,
  accusedName: true,
  accusedBadge: true,
  accusedRank: true,
  accusedDiscordId: true,
  subject: true,
  content: true,
  closing: true,
  sanctions: true,
  filedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      rank: { select: { name: true } },
    },
  },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.LegalCaseSelect

export type LegalCaseRecord = Prisma.LegalCaseGetPayload<{ select: typeof legalCaseSelect }>

function generateLegalCaseToken() {
  return randomBytes(24).toString('base64url')
}

async function createUniqueLegalCaseToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateLegalCaseToken()
    const existing = await prisma.legalCase.findUnique({ where: { token }, select: { id: true } })
    if (!existing) return token
  }
  throw new Error('Klage-Token konnte nicht erstellt werden')
}

/** Nächste freie Aktenzeichen-Nummer im Format `LAD-0001`. */
async function nextLegalCaseNumber() {
  const existing = await prisma.legalCase.findMany({ select: { caseNumber: true } })
  return nextSequenceNumber(LEGAL_CASE_PREFIX, existing.map((row) => row.caseNumber))
}

export async function loadLegalCaseById(id: string) {
  return prisma.legalCase.findUnique({ where: { id }, select: legalCaseSelect })
}

export async function loadLegalCaseByToken(token: string) {
  if (!token) return null
  const legalCase = await prisma.legalCase.findUnique({ where: { token }, select: legalCaseSelect })
  if (!legalCase) return null
  if (legalCase.token !== token) return null
  return legalCase
}

function formatDateDe(value: Date | string | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

type AgentForCase = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId: string | null
  rank?: { name: string } | null
}

type SanctionForCase = {
  id: string
  reason: string
  penalGrade: string
  measureType: string
  fineAmount: number | null
  sgRounds: number | null
  dueAt: Date | null
  createdAt: Date
}

/** Aufbereitete Sanktionsklage: Betreff, Sachverhalt, Antrag und Beweis-Snapshot. */
export function buildSanctionCaseContent(agent: AgentForCase, sanctions: SanctionForCase[]) {
  const name = `${agent.firstName} ${agent.lastName}`.trim()
  const badge = agent.badgeNumber || null

  const subject = `Klage des Federal Investigation Bureau gegen ${name}${badge ? ` (${badge})` : ''} wegen Nichtzahlung offener Sanktion(en) nach Beendigung des Dienstverhältnisses`

  const totalFine = sanctions
    .filter((sanction) => sanction.measureType !== 'SG_ROUNDS' && sanction.fineAmount !== null)
    .reduce((sum, sanction) => sum + (sanction.fineAmount ?? 0), 0)

  const bullets = sanctions.map((sanction) => {
    const measure = sanctionMeasureLabel(sanction)
    const meta = [
      penalGradeLabel(sanction.penalGrade),
      measure,
      sanction.dueAt ? `Frist bis ${formatDateDe(sanction.dueAt)}` : 'ohne Frist',
      `ausgestellt am ${formatDateDe(sanction.createdAt)}`,
    ].join(' · ')
    return `- **${meta}**\n  Grund: ${sanction.reason}`
  })

  const claimAmount = totalFine > 0
    ? ` die offenen Forderungen in Höhe von insgesamt **${formatFineAmount(totalFine)}** nebst Zinsen`
    : ' die offenen Verbindlichkeiten vollständig'

  const content = [
    `Die Klägerin, das **Federal Investigation Bureau**, vertreten durch die Legal Affairs Division, erhebt gegen den Beklagten Klage und trägt hierzu wie folgt vor:`,
    '',
    `1. Der Beklagte stand im Dienst der Klägerin und unterlag dem zwischen den Parteien geschlossenen Arbeitsvertrag.`,
    `2. Das Dienstverhältnis des Beklagten wurde beendet. Gemäß **§ 6 des Arbeitsvertrages** entbindet eine Kündigung oder Entlassung jedoch nicht von bereits bestehenden Verpflichtungen; offene Sanktionen, Geldstrafen und sonstige Forderungen bleiben bestehen und sind vollständig zu begleichen.`,
    `3. Gegen den Beklagten bestehen die nachfolgend näher bezeichneten offenen Sanktionen (siehe Beweismittel):`,
    ...bullets,
    `4. Trotz Fälligkeit und ausdrücklichem Hinweis auf die fortbestehende Zahlungspflicht hat der Beklagte die offenen Beträge bis heute nicht beglichen.`,
  ].join('\n')

  const closing = [
    'Aus den vorgenannten Gründen wird beantragt,',
    '',
    `1. den Beklagten zu verurteilen,${claimAmount} zu begleichen,`,
    '2. festzustellen, dass sich der Beklagte mit der Zahlung in Verzug befindet,',
    '3. dem Beklagten die Kosten des Verfahrens aufzuerlegen.',
  ].join('\n')

  return { subject, content, closing }
}

export interface CreateLegalCaseInput {
  kind: LegalCaseKindValue
  agentId?: string | null
  sanctionIds?: string[]
  title?: string | null
  subject?: string | null
  content?: string | null
  closing?: string | null
  createdById: string
}

/**
 * Erzeugt eine neue Klageschrift. Bei `kind=SANCTION` werden Betreff,
 * Sachverhalt und Antrag automatisch aus den ausgewählten offenen Sanktionen
 * generiert. Verknüpfte Sanktionen werden auf `IN_COURT` gesetzt und mit der
 * Klage verknüpft.
 */
export async function createLegalCase(input: CreateLegalCaseInput) {
  const kind = input.kind

  let agent: AgentForCase | null = null
  if (input.agentId) {
    agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        rank: { select: { name: true } },
      },
    })
    if (!agent) throw new Error('Agent nicht gefunden')
  }

  let sanctionSnapshots: ReturnType<typeof buildSanctionSnapshot> = []
  let selectedSanctionIds: string[] = []

  if (input.sanctionIds && input.sanctionIds.length > 0) {
    if (!agent) throw new Error('Für verknüpfte Sanktionen ist ein Agent erforderlich')
    selectedSanctionIds = Array.from(new Set(input.sanctionIds.map((id) => id.trim()).filter(Boolean)))
    const sanctions = await prisma.sanction.findMany({
      where: { id: { in: selectedSanctionIds } },
    })
    if (sanctions.length !== selectedSanctionIds.length) {
      throw new Error('Eine oder mehrere Sanktionen wurden nicht gefunden')
    }
    const openSanctions = sanctions.filter((sanction) => sanction.status === 'OPEN')
    if (openSanctions.length !== sanctions.length) {
      throw new Error('Nur offene Sanktionen können einer Klage zugeordnet werden')
    }
    for (const sanction of openSanctions) {
      if (sanction.agentId !== agent.id) {
        throw new Error('Sanktion gehört nicht zum ausgewählten Agent')
      }
    }
    sanctionSnapshots = buildSanctionSnapshot(openSanctions)
    selectedSanctionIds = openSanctions.map((sanction) => sanction.id)
  }

  let title: string
  let subject: string
  let content: string
  let closing: string | null

  if (kind === 'SANCTION') {
    if (!agent) throw new Error('Für eine Sanktionsklage ist ein Agent erforderlich')
    if (selectedSanctionIds.length === 0) throw new Error('Mindestens eine offene Sanktion ist erforderlich')

    const sanctions = await prisma.sanction.findMany({
      where: { id: { in: selectedSanctionIds } },
    })
    const generated = buildSanctionCaseContent(agent, sanctions)
    title = input.title?.trim() || 'Sanktionsklage'
    subject = generated.subject
    content = generated.content
    closing = generated.closing
  } else {
    title = input.title?.trim() || 'Klageschrift'
    subject = input.subject?.trim() || ''
    content = input.content?.trim() || ''
    closing = input.closing?.trim() || null
    if (!content) throw new Error('Der Sachverhalt darf nicht leer sein')
  }

  const caseNumber = await nextLegalCaseNumber()
  const token = await createUniqueLegalCaseToken()

  const legalCase = await prisma.$transaction(async (tx) => {
    const created = await tx.legalCase.create({
      data: {
        caseNumber,
        token,
        kind,
        title,
        agentId: agent?.id ?? null,
        accusedName: agent ? `${agent.firstName} ${agent.lastName}`.trim() : null,
        accusedBadge: agent?.badgeNumber ? stripTerminatedBadgeNumber(agent.badgeNumber) : null,
        accusedRank: agent?.rank?.name ?? null,
        accusedDiscordId: agent?.discordId ?? null,
        subject,
        content,
        closing,
        sanctions: sanctionSnapshots as unknown as Prisma.InputJsonValue,
        createdById: input.createdById,
      },
      select: legalCaseSelect,
    })

    if (selectedSanctionIds.length > 0) {
      await tx.sanction.updateMany({
        where: { id: { in: selectedSanctionIds } },
        data: { status: 'IN_COURT', legalCaseId: created.id },
      })
    }

    return created
  })

  return loadLegalCaseById(legalCase.id)
}

export function buildSanctionSnapshot(sanctions: SanctionForCase[]) {
  return sanctions.map((sanction) => ({
    sanctionId: sanction.id,
    reason: sanction.reason,
    penalGrade: sanction.penalGrade,
    measureType: sanction.measureType,
    fineAmount: sanction.fineAmount,
    sgRounds: sanction.sgRounds,
    dueAt: sanction.dueAt ? sanction.dueAt.toISOString() : null,
    createdAt: sanction.createdAt.toISOString(),
  }))
}

export type LegalCaseDocument = Awaited<ReturnType<typeof serializeLegalCase>>

/** Bereitet die Klageschrift für die Anzeige (Dashboard oder geteilter Link) auf. */
export async function serializeLegalCase(record: LegalCaseRecord) {
  const prefix = await getBadgePrefix()
  const sourceBadge = record.accusedBadge ?? record.agent?.badgeNumber ?? ''
  const rawBadge = stripTerminatedBadgeNumber(sourceBadge) || null
  const badge = rawBadge && prefix && !rawBadge.startsWith(prefix)
    ? `${prefix.endsWith('-') ? prefix : `${prefix}-`}${rawBadge}`
    : rawBadge

  return {
    id: record.id,
    token: record.token,
    caseNumber: record.caseNumber,
    kind: record.kind,
    status: record.status,
    title: record.title,
    subject: record.subject,
    content: record.content,
    closing: record.closing,
    accused: {
      name: record.accusedName
        ?? (record.agent ? `${record.agent.firstName} ${record.agent.lastName}`.trim() : null),
      badge,
      rank: record.accusedRank ?? record.agent?.rank?.name ?? null,
      discordId: record.accusedDiscordId ?? record.agent?.discordId ?? null,
      address: null,
    },
    sanctions: readLegalCaseSanctions(record.sanctions),
    signerName: record.createdBy?.displayName?.trim() || null,
    place: CONTRACT_PLACE,
    documentDate: (record.filedAt ?? record.createdAt).toISOString(),
    filedAt: record.filedAt,
    closedAt: record.closedAt,
    createdAt: record.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Sammelklagen (gekündigte Mitarbeiter mit offenen Sanktionen)
// ---------------------------------------------------------------------------

async function createUniqueLegalCaseBatchToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateLegalCaseToken()
    const existing = await prisma.legalCaseBatch.findUnique({ where: { token }, select: { id: true } })
    if (!existing) return token
  }
  throw new Error('Sammelklage-Token konnte nicht erstellt werden')
}

const legalCaseBatchInclude = {
  cases: {
    orderBy: { caseNumber: 'asc' as const },
    select: {
      id: true,
      caseNumber: true,
      token: true,
      kind: true,
      status: true,
      title: true,
      accusedName: true,
      accusedBadge: true,
      accusedRank: true,
      sanctions: true,
      createdAt: true,
    },
  },
} satisfies Prisma.LegalCaseBatchInclude

export type LegalCaseBatchRecord = NonNullable<Awaited<ReturnType<typeof loadLegalCaseBatchByToken>>>

export async function loadLegalCaseBatchByToken(token: string) {
  if (!token) return null
  const batch = await prisma.legalCaseBatch.findUnique({ where: { token }, include: legalCaseBatchInclude })
  if (!batch || batch.token !== token) return null
  return batch
}

/** Aufbereitung einer Sammelklage-Übersicht für den geteilten Link. */
export async function serializeLegalCaseBatch(batch: LegalCaseBatchRecord) {
  const prefix = await getBadgePrefix()
  return {
    token: batch.token,
    title: batch.title,
    createdAt: batch.createdAt.toISOString(),
    caseCount: batch.cases.length,
    cases: batch.cases.map((legalCase) => {
      const sourceBadge = legalCase.accusedBadge ?? ''
      const rawBadge = stripTerminatedBadgeNumber(sourceBadge) || null
      const badge = rawBadge && prefix && !rawBadge.startsWith(prefix)
        ? `${prefix.endsWith('-') ? prefix : `${prefix}-`}${rawBadge}`
        : rawBadge
      return {
        id: legalCase.id,
        caseNumber: legalCase.caseNumber,
        token: legalCase.token,
        kind: legalCase.kind,
        status: legalCase.status,
        title: legalCase.title,
        accusedName: legalCase.accusedName,
        accusedBadge: badge,
        accusedRank: legalCase.accusedRank,
        sanctions: readLegalCaseSanctions(legalCase.sanctions),
      }
    }),
  }
}

function formatSequenceNumberAllocated(prefix: string, value: number) {
  return formatSequenceNumber(prefix, value)
}

/**
 * Erzeugt für jeden gekündigten Mitarbeiter mit offenen Sanktionen genau eine
 * Sanktionsklage und bündelt sie in einer Sammelklage mit eigenem Link-Token.
 * Da die verknüpften Sanktionen dabei auf `IN_COURT` wechseln, erzeugt ein
 * erneuter Lauf keine doppelten Klagen.
 */
export async function createLegalCaseBatch(createdById: string) {
  const agents = await prisma.agent.findMany({
    where: { status: 'TERMINATED', sanctions: { some: { status: 'OPEN' } } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      rank: { select: { name: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  if (agents.length === 0) {
    throw new Error('Keine gekündigten Mitarbeiter mit offenen Sanktionen gefunden')
  }

  const openSanctions = await prisma.sanction.findMany({
    where: { status: 'OPEN', agentId: { in: agents.map((agent) => agent.id) } },
    orderBy: { createdAt: 'asc' },
  })

  const byAgent = new Map<string, typeof openSanctions>()
  for (const sanction of openSanctions) {
    if (!sanction.agentId) continue
    const list = byAgent.get(sanction.agentId) ?? []
    list.push(sanction)
    byAgent.set(sanction.agentId, list)
  }

  const activeAgents = agents.filter((agent) => (byAgent.get(agent.id)?.length ?? 0) > 0)
  if (activeAgents.length === 0) {
    throw new Error('Keine gekündigten Mitarbeiter mit offenen Sanktionen gefunden')
  }

  const existingNumbers = await prisma.legalCase.findMany({ select: { caseNumber: true } })
  const nextFormatted = nextSequenceNumber(LEGAL_CASE_PREFIX, existingNumbers.map((row) => row.caseNumber))
  const baseNumber = parseSequenceNumber(LEGAL_CASE_PREFIX, nextFormatted) ?? 1

  const caseTokens = await Promise.all(activeAgents.map(() => createUniqueLegalCaseToken()))
  const batchToken = await createUniqueLegalCaseBatchToken()

  const batch = await prisma.$transaction(async (tx) => {
    const createdBatch = await tx.legalCaseBatch.create({
      data: { token: batchToken, createdById },
      select: { id: true },
    })

    let index = 0
    for (const agent of activeAgents) {
      const sanctions = byAgent.get(agent.id) ?? []
      const generated = buildSanctionCaseContent(agent, sanctions)
      const caseNumber = formatSequenceNumberAllocated(LEGAL_CASE_PREFIX, baseNumber + index)

      const legalCase = await tx.legalCase.create({
        data: {
          caseNumber,
          token: caseTokens[index],
          kind: 'SANCTION',
          title: 'Sanktionsklage',
          agentId: agent.id,
          accusedName: `${agent.firstName} ${agent.lastName}`.trim(),
          accusedBadge: agent.badgeNumber ? stripTerminatedBadgeNumber(agent.badgeNumber) : null,
          accusedRank: agent.rank?.name ?? null,
          accusedDiscordId: agent.discordId ?? null,
          subject: generated.subject,
          content: generated.content,
          closing: generated.closing,
          sanctions: buildSanctionSnapshot(sanctions) as unknown as Prisma.InputJsonValue,
          batchId: createdBatch.id,
          createdById,
        },
        select: { id: true },
      })

      await tx.sanction.updateMany({
        where: { id: { in: sanctions.map((sanction) => sanction.id) } },
        data: { status: 'IN_COURT', legalCaseId: legalCase.id },
      })

      index += 1
    }

    return createdBatch
  })

  const reloaded = await prisma.legalCaseBatch.findUnique({
    where: { id: batch.id },
    include: legalCaseBatchInclude,
  })
  return reloaded ? serializeLegalCaseBatch(reloaded) : null
}

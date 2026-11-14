import { prisma } from '../prisma'
import type { CurrentUser } from '../auth'
import { chargeLine, mergeCharges, readCharges, type Charge } from './charges'
import { investigationVisibilityWhere } from './investigations'
import type { ShareSelection } from './record-share-kinds'

/**
 * Razzia-Antrag aus den ausgewählten Akten vorbefüllen: Tatvorwürfe aus den
 * Straftatbeständen der Einsatzakten, Betroffene aus Verdächtigen und
 * Familienmitgliedern, Zielobjekt und Anschrift aus der Familienakte,
 * Sachverhalt aus Zusammenfassung und Chronologie. Nur Akten, die der Nutzer
 * sehen darf; Familienakten bringen ihre Einsatzakten mit.
 */
export type RaidPrefill = {
  target: string
  address: string
  suspects: string
  offenses: string
  facts: string
  charges: Charge[]
}

const MAX_FACTS = 11_500
const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
const SUSPECT_ROLES = new Set(['SUSPECT', 'ACCOMPLICE'])

export async function raidPrefill(user: CurrentUser, items: ShareSelection[]): Promise<RaidPrefill> {
  const ids = (kind: ShareSelection['kind']) => [...new Set(items.filter((item) => item.kind === kind).map((item) => item.recordId))]
  const dossierIds = ids('DOSSIER')
  const personIds = ids('PERSON')

  const dossiers = dossierIds.length ? await prisma.dossier.findMany({
    where: { id: { in: dossierIds } },
    select: {
      title: true, address: true,
      leader: { select: { id: true, firstName: true, lastName: true, personNumber: true } },
      investigations: { select: { id: true } },
    },
  }) : []

  const caseIds = [...new Set([...ids('CASE'), ...dossiers.flatMap((dossier) => dossier.investigations.map((row) => row.id))])]
  const cases = caseIds.length ? await prisma.investigation.findMany({
    where: { AND: [{ id: { in: caseIds } }, investigationVisibilityWhere(user)] },
    select: {
      caseNumber: true, title: true, summary: true, charges: true, createdAt: true,
      persons: { select: { role: true, person: { select: { id: true, firstName: true, lastName: true, personNumber: true } } } },
      entries: { select: { title: true, content: true, occurredAt: true }, orderBy: { occurredAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  }) : []
  const persons = personIds.length ? await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, firstName: true, lastName: true, personNumber: true },
  }) : []

  const charges = mergeCharges(...cases.map((row) => readCharges(row.charges)))

  // Betroffene: Fraktionsleitung, Verdächtige/Mittäter der Akten, ausdrücklich gewählte Personen.
  const suspects = new Map<string, string>()
  const addPerson = (person: { id: string; firstName: string; lastName: string; personNumber: string }, note?: string) => {
    if (!suspects.has(person.id)) suspects.set(person.id, `${person.firstName} ${person.lastName} (${person.personNumber})${note ? ` – ${note}` : ''}`)
  }
  for (const dossier of dossiers) if (dossier.leader) addPerson(dossier.leader, `Fraktionsleitung ${dossier.title}`)
  for (const row of cases) for (const link of row.persons) if (SUSPECT_ROLES.has(link.role)) addPerson(link.person)
  for (const person of persons) addPerson(person)

  const facts: string[] = []
  for (const row of cases) {
    const lines = [`Ermittlungsakte ${row.caseNumber} – ${row.title}`]
    if (row.summary?.trim()) lines.push(row.summary.trim())
    const chronology = row.entries
      .filter((entry) => entry.content?.trim() || entry.title)
      .map((entry) => `${dateFormat.format(entry.occurredAt)}: ${entry.title}${entry.content?.trim() ? ` – ${entry.content.trim().replace(/\s*\n+\s*/g, ' ')}` : ''}`)
    if (chronology.length) lines.push(chronology.join('\n'))
    facts.push(lines.join('\n'))
  }
  let factText = facts.join('\n\n')
  if (factText.length > MAX_FACTS) factText = `${factText.slice(0, MAX_FACTS).replace(/\s+\S*$/, '')} … (vollständig in den Anlagen)`

  const dossier = dossiers[0]
  return {
    target: dossier ? (/^anwesen/i.test(dossier.title) ? dossier.title : `Anwesen der ${dossier.title}`) : cases[0]?.title ?? '',
    address: dossiers.map((row) => row.address?.trim()).filter(Boolean).join('; '),
    suspects: [...suspects.values()].join('\n'),
    offenses: charges.map(chargeLine).join('\n'),
    facts: factText,
    charges,
  }
}
